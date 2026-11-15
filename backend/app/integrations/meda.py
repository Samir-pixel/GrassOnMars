"""Mars 2020 MEDA connector: atmospheric measurements at the rover, from the PDS Atmospheres Node.

Bundle: https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ (PDS4).
One CSV table per sensor per sol, each with an XML label that states its size, MD5, record
count and UTC interval. Sols are acquired one at a time; files stay on disk, the database gets
their provenance. The bundle's readme recommends the derived level where a sensor has it
(pressure, humidity, wind) and the calibrated level otherwise (air temperature).
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.http import UpstreamError, fetch, shared_client, write_atomic
from app.models.geo import Dataset
from app.repositories.datasets import upsert_real_dataset

SOURCE = "NASA PDS Atmospheres Node"
BUNDLE_URL = "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"
LICENSE_NOTE = (
    "The product labels state no licence. PDS asks to cite data by DOI or LIDVID at the most "
    "granular level available (https://pds.nasa.gov/datastandards/citing/); the LIDVID of every "
    "file is stored with this record. NASA must be acknowledged as the source."
)
MAX_LABEL_BYTES = 256 * 1024
MAX_TABLE_BYTES = 32 * 1024 * 1024
MISSING = 999999999.0  # used by the wind sensor tables although their labels declare no such constant
TIME_COLUMNS = ("SCLK", "LMST", "LTST")


@dataclass(frozen=True)
class Product:
    collection: str
    sensor: str  # as written in the file names
    dataset_id: str
    columns: tuple[str, ...]  # measurement columns MARSWALK relies on


PRODUCTS = (
    Product("data_derived_env", "DER_PS", "m2020_meda_derived", ("PRESSURE",)),
    Product(
        "data_derived_env",
        "DER_RHS",
        "m2020_meda_derived",
        ("LOCAL_RELATIVE_HUMIDITY", "HUMIDITY_LOCAL_TEMP", "VOLUME_MIXING_RATIO"),
    ),
    Product("data_derived_env", "DER_WS", "m2020_meda_derived", ("HORIZONTAL_WIND_SPEED", "WIND_DIRECTION")),
    Product(
        "data_calibrated_env",
        "CAL_ATS",
        "m2020_meda_calibrated",
        ("ATS_LOCAL_TEMP1", "ATS_LOCAL_TEMP2", "ATS_LOCAL_TEMP3", "ATS_LOCAL_TEMP4", "ATS_LOCAL_TEMP5"),
    ),
)
DATASETS = {
    "m2020_meda_derived": ("Mars 2020 MEDA derived data (pressure, humidity, wind)", "Derived"),
    "m2020_meda_calibrated": ("Mars 2020 MEDA calibrated data (air temperature)", "Calibrated"),
}


@dataclass(frozen=True)
class Label:
    lidvid: str
    file_name: str
    file_size: int
    md5: str
    records: int
    fields: int
    start: datetime
    stop: datetime
    processing_level: str


def _invalid(url: str, reason: str) -> UpstreamError:
    return UpstreamError(
        502, "UPSTREAM_INVALID_DATA", f"{SOURCE}: получены некорректные данные.", SOURCE, url, reason=reason
    )


def _not_archived(url: str, sol: int, reason: str) -> UpstreamError:
    return UpstreamError(
        404, "MEDA_SOL_NOT_ARCHIVED", f"{SOURCE}: данных MEDA за сол {sol} в архиве нет.", SOURCE, url, sol=sol, reason=reason
    )


def _listing(client: httpx.Client, url: str, seen: dict[str, list[str]]) -> list[str]:
    """Entry names of an archive directory page; only plain relative names are kept."""
    if url not in seen:
        # shortcut: listing pages are read without a size bound (the server ignores Range for them
        # and sends no Content-Length); bound the read if listings ever come from another host.
        html = fetch(client, SOURCE, url).text
        seen[url] = re.findall(r'href="([A-Za-z0-9_.]+/?)"', html)
    return seen[url]


def locate(client: httpx.Client, product: Product, sol: int, seen: dict[str, list[str]]) -> str:
    """URL of the product's label. File names carry a version suffix, so they come from the listing."""
    collection = f"{BUNDLE_URL}{product.collection}/"
    for name in _listing(client, collection, seen):
        span = re.fullmatch(r"sol_(\d{4})_(\d{4})/", name)
        if span and int(span[1]) <= sol <= int(span[2]):
            break
    else:
        raise _not_archived(collection, sol, "no directory covers this sol")
    sol_dir = f"sol_{sol:04d}/"
    if sol_dir not in _listing(client, collection + name, seen):
        raise _not_archived(collection + name, sol, "no directory for this sol")
    pattern = re.compile(rf"WE__{sol:04d}_+{product.sensor}_+P(\d\d)\.xml")
    labels = [n for n in _listing(client, collection + name + sol_dir, seen) if pattern.fullmatch(n)]
    if not labels:
        raise _not_archived(collection + name + sol_dir, sol, f"no {product.sensor} product")
    return collection + name + sol_dir + max(labels)  # highest version


def parse_label(xml: bytes, url: str) -> Label:
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise _invalid(url, "not a plain PDS4 label")
    try:
        root = ET.fromstring(xml)
        ns = {"p": root.tag.split("}")[0].lstrip("{")}

        def text(path: str) -> str:
            return root.findtext(path, None, ns).strip()  # AttributeError when the element is missing

        label = Label(
            lidvid=text("p:Identification_Area/p:logical_identifier") + "::" + text("p:Identification_Area/p:version_id"),
            file_name=text("p:File_Area_Observational/p:File/p:file_name"),
            file_size=int(text("p:File_Area_Observational/p:File/p:file_size")),
            md5=text("p:File_Area_Observational/p:File/p:md5_checksum").lower(),
            records=int(text("p:File_Area_Observational/p:Table_Delimited/p:records")),
            fields=int(text("p:File_Area_Observational/p:Table_Delimited/p:Record_Delimited/p:fields")),
            start=datetime.fromisoformat(text("p:Observation_Area/p:Time_Coordinates/p:start_date_time")),
            stop=datetime.fromisoformat(text("p:Observation_Area/p:Time_Coordinates/p:stop_date_time")),
            processing_level=text("p:Observation_Area/p:Primary_Result_Summary/p:processing_level"),
        )
    except (ET.ParseError, AttributeError, ValueError, IndexError) as exc:
        raise _invalid(url, f"unexpected PDS4 label: {exc!r}") from exc
    if not (
        re.fullmatch(r"[A-Za-z0-9_]{1,80}\.CSV", label.file_name)
        and 0 < label.file_size <= MAX_TABLE_BYTES
        and re.fullmatch(r"[0-9a-f]{32}", label.md5)
        and label.records > 0
        and label.start.tzinfo is not None
        and label.start < label.stop
    ):
        raise _invalid(url, "label values fail validation")
    return label


def parse_table(data: bytes, label: Label, product: Product, url: str) -> dict[str, list[Any]]:
    """Columns of a MEDA table. Empty cells and the wind sensor's 999999999 become None."""
    try:
        rows = csv.reader(io.StringIO(data.decode("ascii")))
        header = next(rows)
        # Label field names differ from the CSV header in places, so only the count is compared.
        if len(header) != label.fields or header[:3] != list(TIME_COLUMNS) or not set(product.columns) <= set(header):
            raise ValueError(f"unexpected columns {header}")
        wanted = [header.index(name) for name in product.columns]
        columns: dict[str, list[Any]] = {name: [] for name in (*TIME_COLUMNS, *product.columns)}
        for row in rows:
            if len(row) != len(header):
                raise ValueError(f"row {rows.line_num} has {len(row)} cells")
            columns["SCLK"].append(float(row[0]))
            columns["LMST"].append(row[1])
            columns["LTST"].append(row[2])
            for name, index in zip(product.columns, wanted):
                value = float(row[index]) if row[index] else None
                columns[name].append(None if value == MISSING else value)
        if len(columns["SCLK"]) != label.records:
            raise ValueError(f"{len(columns['SCLK'])} records, the label states {label.records}")
        # UTC of a record is label.start + (SCLK - first SCLK); that only holds if the spans agree.
        span = columns["SCLK"][-1] - columns["SCLK"][0]
        if abs(span - (label.stop - label.start).total_seconds()) > 60:
            raise ValueError("spacecraft clock span disagrees with the label's UTC interval")
        return columns
    except (ValueError, UnicodeDecodeError, StopIteration, IndexError) as exc:
        raise _invalid(url, f"unexpected MEDA table: {exc!r}") from exc


def acquire(client: httpx.Client, product: Product, sol: int, seen: dict[str, list[str]]) -> dict[str, Any]:
    """Download one product, verify it against its label, store both files. Returns its provenance."""
    label_url = locate(client, product, sol, seen)
    xml = fetch(client, SOURCE, label_url, byte_range=(0, MAX_LABEL_BYTES)).content
    label = parse_label(xml, label_url)
    table_url = label_url.rsplit("/", 1)[0] + "/" + label.file_name
    folder = settings.data_dir / "raw" / "meda" / product.collection / f"sol_{sol:04d}"
    local = folder / label.file_name

    def matches_label(content: bytes) -> bool:
        return len(content) == label.file_size and hashlib.md5(content).hexdigest() == label.md5

    data = local.read_bytes() if local.exists() else b""
    if not matches_label(data):  # a local copy that still matches the archive's label is reused
        # A range request bounds the download to the size the label states.
        data = fetch(client, SOURCE, table_url, byte_range=(0, label.file_size)).content
        if not matches_label(data):
            raise _invalid(table_url, "size or MD5 differs from the PDS4 label")
    columns = parse_table(data, label, product, table_url)

    write_atomic(folder / label_url.rsplit("/", 1)[1], xml)
    write_atomic(local, data)
    summary = {}
    for name in product.columns:
        values = [v for v in columns[name] if v is not None]
        summary[name] = {"records_with_value": len(values), **({"min": min(values), "max": max(values)} if values else {})}
    return {
        "lidvid": label.lidvid,
        "label_url": label_url,
        "table_url": table_url,
        "local_file": (folder / label.file_name).relative_to(settings.data_dir.parent).as_posix(),
        "size_bytes": label.file_size,
        "md5": label.md5,  # equals the checksum in the PDS4 label
        "sha256": hashlib.sha256(data).hexdigest(),
        "records": label.records,
        "start_utc": label.start.isoformat(),
        "stop_utc": label.stop.isoformat(),
        "first_sclk": columns["SCLK"][0],
        "first_lmst": columns["LMST"][0],
        "processing_level": label.processing_level,
        "computed_by_marswalk": summary,  # DERIVED figures, kept for sanity checks only
    }


def ingest_sol(db: Session, client: httpx.Client, sol: int) -> list[Dataset]:
    """Acquire every MEDA product of one sol and record provenance. Caller commits."""
    seen: dict[str, list[str]] = {}
    acquired = {product: acquire(client, product, sol, seen) for product in PRODUCTS}
    datasets = []
    for dataset_id, (title, level) in DATASETS.items():
        existing = db.get(Dataset, dataset_id)
        products = dict((existing.extra_metadata or {}).get("products", {})) if existing else {}
        products.update(
            {f"sol_{sol:04d}/{p.sensor}": info for p, info in acquired.items() if p.dataset_id == dataset_id}
        )
        collection = next(p.collection for p in PRODUCTS if p.dataset_id == dataset_id)
        datasets.append(
            upsert_real_dataset(
                db,
                dataset_id,
                step={"step": f"ingest_sol_{sol:04d}", "method": "label and table downloaded; size and MD5 verified against the label"},
                metadata={"products": products},
                title=title,
                mission_id="mars2020",
                instrument_id="meda",
                provider=SOURCE,
                product_id=f"urn:nasa:pds:mars2020_meda:{collection}",
                processing_level=level,
                observed_at_start=min(datetime.fromisoformat(i["start_utc"]) for i in products.values()),
                observed_at_end=max(datetime.fromisoformat(i["stop_utc"]) for i in products.values()),
                native_crs_wkt="None: point measurements at the rover; position per sol is in m2020_rover_waypoints",
                footprint=None,  # the seeded catalogue row carried a placeholder box, not a measured area
                source_archive="NASA PDS Atmospheres Node, bundle mars2020_meda",
                source_url=f"{BUNDLE_URL}{collection}/",
                license_note=LICENSE_NOTE,
                known_limitations=(
                    "Измерения относятся к точке, где стоит марсоход, а не ко всему кратеру. Загружены только отдельные солы. "
                    "По readme архива, влажность до сола 63 и ветер до сола 36 ненадёжны; пустые ячейки означают, "
                    "что значение непригодно для научного использования. В таблицах указаны SCLK и местное солнечное "
                    "время, UTC известен только для начала и конца таблицы."
                ),
            )
        )
    return datasets


def ingested(db: Session) -> tuple[list[Dataset], dict[str, Any], list[int]]:
    """The MEDA dataset rows, the provenance of every ingested product ("sol_0100/DER_PS") and the sols they cover."""
    rows = [r for r in (db.get(Dataset, did) for did in DATASETS) if r]
    products: dict[str, Any] = {}
    for r in rows:
        products.update((r.extra_metadata or {}).get("products", {}))
    return rows, products, sorted({int(k[4:8]) for k in products})


def sol_summary(db: Session, sol: int | None = None) -> dict[str, Any]:
    """DERIVED sol summary from ingested PDS MEDA tables (no synthetic fallback)."""
    from app.core.errors import AppError

    rows, products, sols = ingested(db)
    if not sols:
        raise AppError(503, "DATASET_NOT_ACQUIRED", "Данные MEDA ещё не загружены: выполните python -m app.integrations.meda.")
    chosen = sols[-1] if sol is None else sol
    if chosen not in sols:
        raise AppError(404, "MEDA_SOL_NOT_FOUND", f"Сол {chosen} не загружен в локальный кэш MEDA.", {"available_sols": sols})
    by_sensor = {k.split("/", 1)[1]: v for k, v in products.items() if k.startswith(f"sol_{chosen:04d}/")}
    ats = [by_sensor["CAL_ATS"]["computed_by_marswalk"][c] for c in ("ATS_LOCAL_TEMP1", "ATS_LOCAL_TEMP2", "ATS_LOCAL_TEMP3", "ATS_LOCAL_TEMP4", "ATS_LOCAL_TEMP5") if "CAL_ATS" in by_sensor and "min" in by_sensor["CAL_ATS"]["computed_by_marswalk"].get(c, {})]
    ps = by_sensor.get("DER_PS", {}).get("computed_by_marswalk", {}).get("PRESSURE", {})
    ws = by_sensor.get("DER_WS", {}).get("computed_by_marswalk", {}).get("HORIZONTAL_WIND_SPEED", {})
    rhs = by_sensor.get("DER_RHS", {}).get("computed_by_marswalk", {}).get("LOCAL_RELATIVE_HUMIDITY", {})
    return {
        "sol": chosen,
        "available_sols": sols,
        "data_class": "DERIVED",
        "provenance_ids": [r.id for r in rows],
        "observed_at_start": min(v["start_utc"] for v in by_sensor.values()),
        "observed_at_end": max(v["stop_utc"] for v in by_sensor.values()),
        "air_temp_min_c": round(min(x["min"] for x in ats) - 273.15, 2) if ats else None,
        "air_temp_max_c": round(max(x["max"] for x in ats) - 273.15, 2) if ats else None,
        "pressure_min_pa": ps.get("min"),
        "pressure_max_pa": ps.get("max"),
        "wind_max_m_s": ws.get("max"),
        "humidity_max_pct": rhs.get("max"),
        "records": {s: v["records"] for s, v in by_sensor.items()},
    }


if __name__ == "__main__":  # python -m app.integrations.meda 100 [101 ...]
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        # Default: the reference sol, the next one (same rover position) and one from another season, for comparison.
        for number in [int(arg) for arg in sys.argv[1:]] or [100, 101, 300]:
            try:
                records = ingest_sol(session, shared_client(), number)
            except UpstreamError as exc:
                raise SystemExit(f"{exc.code}: {exc.message_ru} {exc.details}") from exc
            session.commit()
            print(f"sol {number}:", ", ".join(f"{r.id} ({len(r.extra_metadata['products'])} products)" for r in records))
