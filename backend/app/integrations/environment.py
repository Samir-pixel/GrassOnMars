"""Environmental monitoring: a registry of sources and binned MEDA time series.

A series is one instrument at one place on one sol, read from the PDS tables that
app.integrations.meda downloaded and verified. Nothing here interpolates between places,
carries a measurement to another time, or forecasts.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.integrations import meda
from app.models.geo import Dataset
from app.repositories import ops as ops_repo

STATION = "m2020_meda"
MISSION = "Mars 2020 Perseverance"
ROVER_PLACE = "Perseverance rover, Jezero crater"
KINDS = {
    "HISTORICAL_OBSERVATION": "An archived instrument record, as measured at a stated place and time. "
    "In Marswalk: the MEDA tables behind these charts.",
    "PROCESSED_OBSERVATION": "Computed from historical observations without a model. "
    "In Marswalk: the bin means on these charts and the THEMIS mosaics.",
    "MODEL_ESTIMATE": "Computed from a formula, not measured. In Marswalk: air pressure from elevation on Compare sites.",
    "SIMULATION": "A scenario value or a stated assumption. In Marswalk: the dust slider and the EVA walk check.",
}
NOTICE = (
    "Archived measurements, not current weather and not a forecast. MEDA values describe the rover's "
    "position on that sol; they are not extended to the rest of Jezero crater."
)
PARAMETER_LABELS = {
    "air_temperature": "Air temperature",
    "surface_temperature": "Surface temperature",
    "pressure": "Atmospheric pressure",
    "wind_speed": "Wind speed",
    "wind_direction": "Wind direction",
    "dust": "Dust activity",
    "radiation": "Radiation",
}


@dataclass(frozen=True)
class Parameter:
    id: str
    unit: str
    sensor: str  # MEDA product the columns come from
    instrument: str
    columns: tuple[str, ...]
    method: str
    offset: float = 0.0
    circular: bool = False


_COLUMNS = {p.sensor: p.columns for p in meda.PRODUCTS}
PARAMETERS = {
    p.id: p
    for p in (
        Parameter(
            "air_temperature",
            "°C",
            "CAL_ATS",
            "MEDA ATS (air temperature sensors)",
            _COLUMNS["CAL_ATS"],
            "Mean of the five ATS sensors (three on the mast, two on the rover body), archived in kelvin and shown "
            "minus 273.15. The band runs from the lowest to the highest sensor reading in the bin.",
            offset=-273.15,
        ),
        Parameter(
            "pressure",
            "Pa",
            "DER_PS",
            "MEDA PS (pressure sensor)",
            ("PRESSURE",),
            "Mean of the readings in the bin. The band runs from the lowest to the highest reading.",
        ),
        Parameter(
            "wind_speed",
            "m/s",
            "DER_WS",
            "MEDA WS (wind sensor)",
            ("HORIZONTAL_WIND_SPEED",),
            "Mean horizontal wind speed in the bin. The band runs from the lowest to the highest reading.",
        ),
        Parameter(
            "wind_direction",
            "deg",
            "DER_WS",
            "MEDA WS (wind sensor)",
            ("WIND_DIRECTION",),
            "Circular mean of the archived direction angles in the bin, 0 to 360 degrees as defined in the MEDA "
            "data product specification. No band: a minimum and maximum mean nothing across the 360/0 wrap.",
            circular=True,
        ),
    )
}
MEDA_NOTE = (
    "Measured at the rover, so it describes that spot on that sol, not the whole crater. Only the listed sols are "
    "loaded. Per the archive readme, wind before sol 36 is unreliable and an empty cell means the value is unfit "
    "for science; such cells are shown as gaps."
)
# Sources without a time series here. Each says why, so a missing chart is never mistaken for calm weather.
OTHER_SOURCES: tuple[dict[str, Any], ...] = (
    {
        "id": "themis_ir",
        "parameters": ["surface_temperature"],
        "instrument": "THEMIS infrared camera",
        "mission": "2001 Mars Odyssey",
        "location": {"name": "Jezero crater, seen from orbit", "lat": None, "lon": None},
        "kind": "PROCESSED_OBSERVATION",
        "availability": "map",
        "dataset_ids": ["odyssey_themis_day_ir_100m", "odyssey_themis_night_ir_100m"],
        "note": "Day and night infrared mosaics at 100 m. Brightness shows which ground is relatively warmer or "
        "cooler; it is not calibrated, so no temperature can be read from it. Calibrated surface temperature is "
        "not loaded. The tile service states no observation dates.",
    },
    {
        "id": "meda_dust",
        "parameters": ["dust"],
        "instrument": "MEDA RDS (radiation and dust sensor) and SkyCam",
        "mission": MISSION,
        "location": {"name": ROVER_PLACE, "lat": None, "lon": None},
        "kind": "HISTORICAL_OBSERVATION",
        "availability": "not_integrated",
        "dataset_ids": [],
        "source_url": meda.BUNDLE_URL,
        "note": "These tables are in the MEDA archive but not loaded. The dust value in a Marswalk plan is a fixed "
        "baseline with a slider for storm scenarios: an assumption and a simulation, not a measurement.",
    },
    {
        "id": "msl_rems",
        "parameters": ["air_temperature", "surface_temperature", "pressure", "wind_speed", "wind_direction"],
        "instrument": "REMS (Rover Environmental Monitoring Station)",
        "mission": "Mars Science Laboratory Curiosity",
        "location": {"name": "Gale crater (landing site)", "lat": -4.5895, "lon": 137.4417},
        "kind": "HISTORICAL_OBSERVATION",
        "availability": "not_integrated",
        "dataset_ids": [],
        "source_url": "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html",
        "note": "Curiosity works in Gale crater, a different region of Mars. Its weather does not describe Jezero, "
        "so it is not loaded and is never mixed into the Jezero charts.",
    },
    {
        "id": "msl_rad",
        "parameters": ["radiation"],
        "instrument": "RAD (Radiation Assessment Detector)",
        "mission": "Mars Science Laboratory Curiosity",
        "location": {"name": "Gale crater (landing site)", "lat": -4.5895, "lon": 137.4417},
        "kind": "HISTORICAL_OBSERVATION",
        "availability": "not_integrated",
        "dataset_ids": [],
        "source_url": "https://pds-ppi.igpp.ucla.edu/mission/Mars_Science_Laboratory/MSL/RAD",
        "note": "Surface radiation measured in Gale crater, not in Jezero. Not loaded: the dose in a Marswalk "
        "report uses one published RAD average as a constant, not a series.",
    },
    {
        "id": "odyssey_marie",
        "parameters": ["radiation"],
        "instrument": "MARIE (Martian Radiation Environment Experiment)",
        "mission": "2001 Mars Odyssey",
        "location": {"name": "Mars orbit", "lat": None, "lon": None},
        "kind": "HISTORICAL_OBSERVATION",
        "availability": "not_integrated",
        "dataset_ids": [],
        "source_url": "https://pds-geosciences.wustl.edu/missions/odyssey/marie.html",
        "note": "Measured in orbit in 2002 and 2003, not on the surface. Not loaded.",
    },
)


def _sols(products: dict[str, Any], sensor: str) -> list[int]:
    return sorted(int(key[4:8]) for key in products if key.endswith("/" + sensor))


def _position(db: Session, sol: int) -> dict[str, Any] | None:
    found = ops_repo.rover_position(db, sol)
    return found and {"sol": sol, **found}


def registry(db: Session) -> dict[str, Any]:
    """Every environmental source: what it measures, where, what kind of data it is and whether it is loaded."""
    _, products, sols = meda.ingested(db)
    wanted = {i for s in OTHER_SOURCES for i in s["dataset_ids"]} | set(meda.DATASETS)
    datasets = {d.id: d for d in db.scalars(select(Dataset).where(Dataset.id.in_(wanted)))}

    sources = []
    for product in meda.PRODUCTS:
        parameters = [p.id for p in PARAMETERS.values() if p.sensor == product.sensor]
        if not parameters:
            continue
        have = _sols(products, product.sensor)
        infos = [products[f"sol_{sol:04d}/{product.sensor}"] for sol in have]
        sources.append(
            {
                "id": f"meda_{product.sensor.lower()}",
                "parameters": parameters,
                "instrument": PARAMETERS[parameters[0]].instrument,
                "mission": MISSION,
                "location": {"name": ROVER_PLACE, "lat": None, "lon": None},  # it moves: see positions
                "kind": "HISTORICAL_OBSERVATION",
                "availability": "series" if have else "not_acquired",
                "dataset_ids": [product.dataset_id],
                "available_sols": have,
                "observed_at_start": min((i["start_utc"] for i in infos), default=None),
                "observed_at_end": max((i["stop_utc"] for i in infos), default=None),
                "note": MEDA_NOTE,
            }
        )
    sources += [{"available_sols": [], "observed_at_start": None, "observed_at_end": None, **s} for s in OTHER_SOURCES]
    for source in sources:
        first = next((datasets[i] for i in source["dataset_ids"] if i in datasets), None)
        source.setdefault("source_url", first.source_url if first else None)
        source["data_class"] = first.data_class if first else None
        source["processing_level"] = first.processing_level if first else None

    return {
        "notice": NOTICE,
        "kinds": KINDS,
        "parameters": [
            {"id": key, "label": label, "unit": PARAMETERS[key].unit if key in PARAMETERS else None, "series": key in PARAMETERS}
            for key, label in PARAMETER_LABELS.items()
        ],
        "stations": [
            {"id": STATION, "name": "Perseverance MEDA, Jezero crater", "available": bool(sols)},
            {"id": "msl_rems", "name": "Curiosity REMS, Gale crater", "available": False},
        ],
        "sources": sources,
        # shortcut: one query per ingested sol, fine for a handful; batch it when hundreds of sols are loaded.
        "positions": [p for p in (_position(db, sol) for sol in sols) if p],
    }


def _lmst_hours(lmst: str, sol: int) -> float:
    """Hours since local mean midnight of `sol` for a MEDA stamp such as 00100M04:00:28.047."""
    day, clock = lmst.split("M")
    hours, minutes, seconds = clock.split(":")
    return (int(day) - sol) * 24 + int(hours) + int(minutes) / 60 + float(seconds) / 3600


def _summarise(values: list[float], param: Parameter) -> tuple[float | None, float | None, float | None]:
    """Value, minimum and maximum of a bin. A bin without usable readings stays empty: a gap, not a zero."""
    if not values:
        return None, None, None
    if param.circular:
        east = sum(math.sin(math.radians(v)) for v in values)
        north = sum(math.cos(math.radians(v)) for v in values)
        return round(math.degrees(math.atan2(east, north)) % 360, 1) % 360, None, None  # 359.97 rounds to 360, which is 0
    return (
        round(sum(values) / len(values) + param.offset, 2),
        round(min(values) + param.offset, 2),
        round(max(values) + param.offset, 2),
    )


@lru_cache(maxsize=64)
def _bins(
    path: str, mtime_ns: int, parameter: str, sol: int, bin_minutes: int, start_utc: str, first_sclk: float
) -> tuple[dict[str, Any], ...]:
    """The table binned by local mean solar time. Cached per file version: a sol table has 50-90 thousand rows."""
    param = PARAMETERS[parameter]
    cells: dict[int, list[Any]] = {}  # bin -> [SCLK of its first record, cells read, usable values]
    with open(path, newline="", encoding="ascii") as table:
        rows = csv.reader(table)
        header = next(rows)
        wanted = [header.index(name) for name in param.columns]
        for row in rows:
            cell = cells.setdefault(int(_lmst_hours(row[1], sol) * 60 // bin_minutes), [float(row[0]), 0, []])
            cell[1] += len(wanted)
            cell[2] += [v for v in (float(row[i]) for i in wanted if row[i]) if v != meda.MISSING]
    start = datetime.fromisoformat(start_utc)
    points = []
    for key in sorted(cells):
        sclk, read, values = cells[key]
        value, low, high = _summarise(values, param)
        points.append(
            {
                # UTC of the bin's first record: the label's start time plus the spacecraft clock offset.
                "time_utc": (start + timedelta(seconds=sclk - first_sclk)).isoformat(),
                "lmst_h": round(key * bin_minutes / 60, 4),
                "value": value,
                "min": low,
                "max": high,
                "samples": len(values),
                "valid_share": round(len(values) / read, 3),
            }
        )
    return tuple(points)


def series(
    db: Session, parameter: str, sol: int | None = None, lmst_from: float = 0, lmst_to: float = 24, bin_minutes: int = 15
) -> dict[str, Any]:
    """One parameter at the rover on one sol, binned by local time. PROCESSED from the archived table."""
    param = PARAMETERS[parameter]
    _, products, _ = meda.ingested(db)
    have = _sols(products, param.sensor)
    if not have:
        raise AppError(503, "DATASET_NOT_ACQUIRED", "Данные MEDA ещё не загружены: выполните python -m app.integrations.meda.")
    chosen = have[-1] if sol is None else sol
    if chosen not in have:
        raise AppError(404, "MEDA_SOL_NOT_FOUND", f"Сол {chosen} не загружен в локальный кэш MEDA.", {"available_sols": have})
    info = products[f"sol_{chosen:04d}/{param.sensor}"]
    path = settings.data_dir.parent / info["local_file"]
    if not path.is_file() or path.stat().st_size != info["size_bytes"]:
        raise AppError(
            503,
            "DATASET_NOT_ACQUIRED",
            "Таблица MEDA отсутствует на диске или изменена: повторите python -m app.integrations.meda.",
            {"sol": chosen, "product": param.sensor},
        )
    binned = _bins(str(path), path.stat().st_mtime_ns, param.id, chosen, bin_minutes, info["start_utc"], info["first_sclk"])
    points = [p for p in binned if lmst_from <= p["lmst_h"] < lmst_to]
    dataset_id = next(p.dataset_id for p in meda.PRODUCTS if p.sensor == param.sensor)
    location = _position(db, chosen)
    samples = sum(p["samples"] for p in points)
    return {
        "parameter": param.id,
        "label": PARAMETER_LABELS[param.id],
        "unit": param.unit,
        "kind": "PROCESSED_OBSERVATION",
        "data_class": "DERIVED",
        "provenance_ids": [dataset_id, *([location["dataset_id"]] if location else [])],
        "station": STATION,
        "mission": MISSION,
        "instrument": param.instrument,
        "source_dataset": dataset_id,
        "product": {key: info[key] for key in ("lidvid", "label_url", "table_url", "processing_level", "md5", "records")},
        "sol": chosen,
        "available_sols": have,
        "observed_at_start": info["start_utc"],
        "observed_at_end": info["stop_utc"],
        "location": location,
        "bin_minutes": bin_minutes,
        "lmst_from": lmst_from,
        "lmst_to": lmst_to,
        "method": param.method,
        "quality": {
            "samples": samples,
            "empty_bins": sum(p["samples"] == 0 for p in points),
            "bins": len(points),
            "note": MEDA_NOTE,
        },
        "notice": NOTICE,
        "points": points,
    }
