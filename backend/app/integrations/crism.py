"""NASA MRO CRISM MTRDR mineralogy browse product connector (PDS Geosciences Node).

Product: FRT00005C5E_07_BRHYDJ_MTR3 (Hydrated Mineralogy RGB browse with alpha transparency for NoData).
Covers Jezero floor, delta front, Margin carbonates, and Belva crater at 18 m/px,
equirectangular planetocentric projection.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.http import UpstreamError, fetch, shared_client, write_atomic
from app.models.geo import Dataset, Instrument, MapLayer
from app.repositories.datasets import upsert_real_dataset

SOURCE = "NASA PDS Geosciences Node (MRO CRISM)"
DATASET_ID = "mro_crism_hyd_jezero"
LAYER_ID = "crism_hyd_jezero"
PRODUCT_ID = "FRT00005C5E_07_BRHYDJ_MTR3"
BASE_URL = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/browse/2007/2007_139/frt00005c5e"
PNG_URL = f"{BASE_URL}/{PRODUCT_ID.lower()}.png"
LBL_URL = f"{BASE_URL}/{PRODUCT_ID.lower()}.lbl"
PNG_SIG = b"\x89PNG\r\n\x1a\n"
LICENSE_NOTE = (
    "NASA PDS3 peer-reviewed MTRDR browse product (JHU/APL). "
    "Cite MRO-M-CRISM-5-RDR-MPTARGETED-V1.0 and Viviano-Beck et al. (2014)."
)


def png_path() -> Path:
    return settings.data_dir / "raw" / "crism" / f"{PRODUCT_ID.lower()}.png"


def lbl_path() -> Path:
    return settings.data_dir / "raw" / "crism" / f"{PRODUCT_ID.lower()}.lbl"


def parse_label(text: str, url: str) -> dict[str, Any]:
    def num(key: str) -> float:
        m = re.search(rf"^\s*{key}\s*=\s*([+-]?\d+(?:\.\d+)?)", text, re.M)
        if not m:
            raise UpstreamError(502, "UPSTREAM_INVALID_DATA", f"{SOURCE}: отсутствует {key}.", SOURCE, url)
        return float(m[1])

    st = re.search(r"^\s*START_TIME\s*=\s*(\S+)", text, re.M)
    if not st:
        raise UpstreamError(502, "UPSTREAM_INVALID_DATA", f"{SOURCE}: отсутствует START_TIME.", SOURCE, url)
    return {
        "start_time": datetime.fromisoformat(st[1].rstrip("Z")).replace(tzinfo=timezone.utc),
        "bbox": [num("WESTERNMOST_LONGITUDE"), num("MINIMUM_LATITUDE"), num("EASTERNMOST_LONGITUDE"), num("MAXIMUM_LATITUDE")],
        "resolution_m": num("MAP_SCALE") * 1000.0,
    }


def ingest(db: Session, client: httpx.Client) -> Dataset:
    lbl_text = fetch(client, SOURCE, LBL_URL).text
    meta = parse_label(lbl_text, LBL_URL)
    png = fetch(client, SOURCE, PNG_URL).content
    if not png.startswith(PNG_SIG):
        raise UpstreamError(502, "UPSTREAM_INVALID_DATA", f"{SOURCE}: файл не является PNG.", SOURCE, PNG_URL)
    write_atomic(lbl_path(), lbl_text.encode("utf-8"))
    write_atomic(png_path(), png)
    sha = hashlib.sha256(png).hexdigest()

    if db.get(Instrument, "crism") is None:
        db.add(Instrument(
            id="crism",
            mission_id="mro",
            name="Compact Reconnaissance Imaging Spectrometer for Mars",
            acronym="CRISM",
            description_ru="Спектрометр ближнего ИК-диапазона для картирования минералов.",
        ))
        db.flush()

    dataset = upsert_real_dataset(
        db,
        DATASET_ID,
        step={"step": "ingest_crism_mtrdr_browse", "label_url": LBL_URL, "png_sha256": sha},
        metadata={"bands_rgb": ["SINDEX2", "BD2100_2", "BD1900_2"], "product_url": PNG_URL},
        bbox=meta["bbox"],
        title="MRO CRISM Hydrated Mineralogy (Jezero, FRT00005C5E MTRDR)",
        mission_id="mro",
        instrument_id="crism",
        provider=SOURCE,
        product_id=PRODUCT_ID,
        observed_at_start=meta["start_time"],
        observed_at_end=meta["start_time"],
        processing_level="MTRDR Map-Projected Browse (RGBA, transparent NoData)",
        spatial_resolution_m=meta["resolution_m"],
        native_crs_wkt="EQUIRECTANGULAR PLANETOCENTRIC MARS (center lat 15 deg, +East)",
        source_archive="NASA PDS Geosciences Node",
        source_url=PNG_URL,
        raster_uri=png_path().relative_to(settings.data_dir.parent).as_posix(),
        sha256_checksum=sha,
        license_note=LICENSE_NOTE,
        known_limitations=(
            "Обзорный 8-битный RGB-продукт спектральных индексов (R: полигидратированные сульфаты SINDEX2, "
            "G: моногидратированные сульфаты/глины BD2100_2, B: связанная вода BD1900_2). Прозрачность = нет данных."
        ),
    )

    layer = db.get(MapLayer, LAYER_ID) or MapLayer(id=LAYER_ID)
    layer.dataset_id = DATASET_ID
    layer.title_ru = "Минералогия CRISM (гидратированные фазы, 18 м)"
    layer.kind = "image_overlay"
    layer.z_index = 25
    layer.visible_by_default = False
    layer.legend_spec = {
        "units": "spectral summary RGB",
        "stops": [
            {"color": "#ff32c8", "label": "Magenta: polyhydrated sulfates"},
            {"color": "#d6d632", "label": "Yellow/green: monohydrated / clays"},
            {"color": "#3898ff", "label": "Blue: bound H2O / hydrated minerals"},
        ],
    }
    layer.service = {
        "type": "image_overlay",
        "image_url": f"/api/v1/layers/{LAYER_ID}/image",
        "bbox": meta["bbox"],
        "crs": "PLANETOCENTRIC EQUIRECTANGULAR",
        "attribution": "NASA PDS · MRO CRISM (FRT00005C5E)",
    }
    db.add(layer)
    db.flush()
    return dataset


if __name__ == "__main__":  # python -m app.integrations.crism
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        ds = ingest(session, shared_client())
        session.commit()
        print("ingested:", ds.id, "->", ds.raster_uri)
