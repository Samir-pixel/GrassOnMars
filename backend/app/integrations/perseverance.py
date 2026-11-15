"""Mars 2020 Perseverance connector: rover waypoints (surface localisation).

Source: the GeoJSON behind NASA's "Where is Perseverance?" map,
https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
Each feature is one localisation of the rover: lon/lat, elevation, sol, site/drive counters (RMC).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

import httpx
from geoalchemy2 import WKTElement
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.http import UpstreamError, fetch, shared_client, write_atomic
from app.models.geo import MARS_SRID, Dataset, ScientificTarget
from app.repositories.datasets import upsert_real_dataset

SOURCE = "NASA Mars 2020 (mars.nasa.gov)"
URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
DATASET_ID = "m2020_rover_waypoints"
LICENSE_NOTE = (
    "NASA material is generally not subject to copyright in the United States; NASA must be "
    "acknowledged as the source and no endorsement implied "
    "(https://www.nasa.gov/nasa-brand-center/images-and-media/). Credit: NASA/JPL-Caltech."
)
JEZERO_BOX = (76.5, 17.5, 78.5, 19.5)  # west, south, east, north: a waypoint outside is not Perseverance
PLAUSIBLE_M = (-9000, 22000)
_RMC = re.compile(r"^\d{1,6}_\d{1,6}$")
NOTES_RU = {
    "End-of-drive localization": "локализация в конце перегона",
    "Mid-drive localization": "локализация в середине перегона",
    "Interpolated": "положение интерполировано NASA между локализациями",
    "Site increment, no motion.": "смена номера участка без движения",
}


@dataclass(frozen=True)
class Waypoint:
    rmc: str  # "site_drive", the rover's own position counter
    sol: int
    lon: float
    lat: float
    elevation_m: float
    distance_total_m: float | None
    note: str


def _invalid(reason: str) -> UpstreamError:
    return UpstreamError(
        502, "UPSTREAM_INVALID_DATA", f"{SOURCE}: получены некорректные данные.", SOURCE, URL, reason=reason
    )


def parse_waypoints(data: bytes) -> tuple[str, list[Waypoint]]:
    """Validate the GeoJSON; returns the product name and its waypoints. One bad feature rejects the file."""
    try:
        doc = json.loads(data)
        if doc["type"] != "FeatureCollection" or not doc["features"]:
            raise ValueError("not a non-empty FeatureCollection")
        waypoints = []
        for index, feature in enumerate(doc["features"]):
            props, geometry = feature["properties"], feature["geometry"]
            lon, lat = (float(v) for v in geometry["coordinates"][:2])
            elevation, sol, rmc = float(props["elev_geoid"]), props["sol"], props["RMC"]
            total = props.get("dist_total_m")
            if not (
                geometry["type"] == "Point"
                and JEZERO_BOX[0] <= lon <= JEZERO_BOX[2]
                and JEZERO_BOX[1] <= lat <= JEZERO_BOX[3]
                and PLAUSIBLE_M[0] <= elevation <= PLAUSIBLE_M[1]
                and isinstance(sol, int)
                and 0 <= sol < 100_000
                and isinstance(rmc, str)
                and _RMC.match(rmc)
                and (total is None or (isinstance(total, (int, float)) and math.isfinite(total)))
            ):
                raise ValueError(f"feature {index} fails validation")
            waypoints.append(Waypoint(rmc, sol, lon, lat, elevation, total, str(props.get("Note") or "")))
        if len({w.rmc for w in waypoints}) != len(waypoints):
            raise ValueError("duplicate RMC")
        return str(doc.get("name") or "M20_waypoints"), waypoints
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        raise _invalid(f"unexpected waypoint GeoJSON: {exc!r}") from exc


def ingest(db: Session, client: httpx.Client) -> Dataset:
    """Download the waypoints, keep the file as received, replace this dataset's targets. Caller commits."""
    data = fetch(client, SOURCE, URL).content
    name, waypoints = parse_waypoints(data)  # validated before anything is stored
    checksum = hashlib.sha256(data).hexdigest()
    path = settings.data_dir / "raw" / "m2020" / "M20_waypoints.json"
    write_atomic(path, data)
    notes = Counter(w.note for w in waypoints)

    dataset = upsert_real_dataset(
        db,
        DATASET_ID,
        step={"step": "ingest_waypoints", "features": len(waypoints), "sha256": checksum},
        metadata={
            "raw_file": path.relative_to(settings.data_dir.parent).as_posix(),
            "sol_range": [min(w.sol for w in waypoints), max(w.sol for w in waypoints)],
            "localisation_notes": dict(notes),
        },
        bbox=(
            min(w.lon for w in waypoints),
            min(w.lat for w in waypoints),
            max(w.lon for w in waypoints),
            max(w.lat for w in waypoints),
        ),
        title="Mars 2020 Perseverance rover waypoints (surface localisation)",
        mission_id="mars2020",
        provider=SOURCE,
        product_id=name,
        processing_level="Mission localisation product",
        native_crs_wkt="GeoJSON longitude/latitude in degrees, no CRS member; elevation in metres",
        vertical_datum="elev_geoid, as named in the product",
        source_archive="mars.nasa.gov MMGIS map layers",
        source_url=URL,
        sha256_checksum=checksum,
        license_note=LICENSE_NOTE,
        known_limitations=(
            f"{notes.get('Interpolated', 0)} из {len(waypoints)} точек NASA помечает как интерполированные. "
            "В файле указаны солы, но не земные даты. Продукт обновляется по мере движения марсохода: "
            "запись отражает состояние на момент загрузки."
        ),
    )
    db.execute(delete(ScientificTarget).where(ScientificTarget.dataset_id == DATASET_ID))
    db.add_all(
        ScientificTarget(
            id=f"m2020_wp_{w.rmc}",
            dataset_id=DATASET_ID,
            name=f"Perseverance, сол {w.sol} (RMC {w.rmc})",
            category="rover_waypoint",
            description_ru=(
                f"Положение марсохода Perseverance, сол {w.sol}: {NOTES_RU.get(w.note, w.note) or 'без примечания'}."
                + (f" Пройдено с начала миссии: {w.distance_total_m:.0f} м." if w.distance_total_m is not None else "")
            ),
            geom=WKTElement(f"POINT({w.lon} {w.lat})", srid=MARS_SRID),
            elevation_m=w.elevation_m,
            rover_sol=w.sol,
            source_identifier=w.rmc,
            is_demonstration=False,
        )
        for w in waypoints
    )
    db.flush()
    return dataset


if __name__ == "__main__":  # python -m app.integrations.perseverance
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        try:
            record = ingest(session, shared_client())
        except UpstreamError as exc:
            raise SystemExit(f"{exc.code}: {exc.message_ru} {exc.details}") from exc
        session.commit()
        print("ingested:", record.id, record.extra_metadata["sol_range"], record.extra_metadata["localisation_notes"])
