"""MRO CTX elevation connector: the Jezero DTM mosaic USGS made for Mars 2020 Terrain Relative Navigation.

Page: https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic
20 m grid, float32 metres, controlled to MOLA. The whole product is the Jezero region (9.7 MB),
so it is stored unchanged and its checksum is the checksum of the USGS file.
"""

from __future__ import annotations

import hashlib
import math
from array import array
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.integrations import geotiff
from app.integrations.http import UpstreamError, shared_client, write_atomic
from app.models.geo import Dataset
from app.repositories.datasets import upsert_real_dataset

SOURCE = "USGS Astrogeology"
TITLE = "USGS CTX DTM 20 m"
PRODUCT_ID = "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0"
URL = f"https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/{PRODUCT_ID}.tif"
PAGE_URL = "https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic"
DATASET_ID = "mro_ctx_dtm_jezero_20m"
DOI = "10.5066/P906QQT8"
RESOLUTION_M = 20.0
SEMI_MAJOR_M = 3396190.0
VERTICAL_DATUM = "MOLA areoid (product controlled to MOLA topography)"
LICENSE_NOTE = (
    'Access constraints: none; use constraints: "Please cite authors" — as stated on the USGS '
    "Astrogeology product page. Authors: Fergason, R. L., Hare, T. M., Mayer, D. P., Galuszka, D. M., "
    "Redding, B. L., Smith, E. D., Shinaman, J. R., Cheng, Y., Otero, R. E. (2020), "
    f"https://doi.org/{DOI}"
)
MAX_FILE_BYTES = 32 * 1024 * 1024  # the product is 9.7 MB; anything far larger is not it
PLAUSIBLE_M = (-9000, 22000)
MAX_GRID_CELLS = 400_000  # 1.6 MB of float32 per response; the whole product at step 3 is 268 000 cells


def product_path() -> Path:
    return settings.data_dir / "raw" / "ctx" / f"{PRODUCT_ID}.tif"


def pixels_per_degree(tiff: geotiff.GeoTiff) -> float:
    return math.pi * SEMI_MAJOR_M / 180 / tiff.pixel_scale  # 2963.7349, as on the product page


def acquire(client: httpx.Client) -> dict[str, Any]:
    """Download the product, validate it and store it unchanged. Returns its provenance."""
    read = geotiff.RangeReader(client, SOURCE, URL)
    tiff = geotiff.open_geotiff(read, SOURCE, URL)  # the directory first: the size is known before the body
    etag, last_modified, size = read.stamp  # type: ignore[misc]
    if (tiff.typecode, tiff.pixel_scale, tiff.semi_major_m) != ("f", RESOLUTION_M, SEMI_MAJOR_M) or size > MAX_FILE_BYTES:
        raise geotiff.invalid_data(SOURCE, URL, "not the published 20 m float32 grid on the 3 396 190 m sphere")
    data = read(0, size)
    try:
        samples = geotiff.read_window(tiff, lambda o, n: data[o : o + n], 0, 0, tiff.width, tiff.height)
    except ValueError as exc:
        raise geotiff.invalid_data(SOURCE, URL, f"pixel data: {exc}") from exc
    valid = array("f", (v for v in samples if v != tiff.nodata))
    if not valid or min(valid) < PLAUSIBLE_M[0] or max(valid) > PLAUSIBLE_M[1]:
        raise geotiff.invalid_data(SOURCE, URL, "elevations outside the plausible range")

    path = product_path()
    write_atomic(path, data)
    return {
        "source_url": URL,
        "source_etag": etag,
        "source_last_modified": last_modified,
        "source_size_bytes": size,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_px": [tiff.width, tiff.height],
        "bbox": geotiff.bounds(tiff, pixels_per_degree(tiff)),
        "citation": tiff.citation,
        "nodata": tiff.nodata,
        "cells_with_data": len(valid),
        "min_elevation_m": round(min(valid), 3),
        "max_elevation_m": round(max(valid), 3),
        "path": path,
    }


def ingest(db: Session, client: httpx.Client) -> Dataset:
    """Acquire the product and write its provenance record. Caller commits."""
    info = acquire(client)
    path: Path = info.pop("path")
    return upsert_real_dataset(
        db,
        DATASET_ID,
        step={"step": "download_product", "method": "complete file, stored unchanged", "sha256": info["sha256"]},
        metadata={"product_page": PAGE_URL, "publication_date": "2020-07-24", "acquisition": info},
        bbox=info["bbox"],
        title="MRO CTX DTM mosaic, Jezero, 20 m (Mars 2020 TRN, USGS)",
        mission_id="mro",
        instrument_id="ctx",
        provider=SOURCE,
        product_id=PRODUCT_ID,
        doi=DOI,
        processing_level="DTM mosaic controlled to MOLA",
        spatial_resolution_m=RESOLUTION_M,
        native_crs_wkt=info["citation"],
        vertical_datum=VERTICAL_DATUM,
        source_archive="USGS Astrogeology Science Center (Astropedia)",
        source_url=URL,
        raster_uri=path.relative_to(settings.data_dir.parent).as_posix(),
        sha256_checksum=info["sha256"],
        license_note=LICENSE_NOTE,
        known_limitations=(
            "Сетка 20 м: объекты мельче нескольких десятков метров (камни, небольшие уступы) не разрешаются. "
            "Покрывает только западную часть кратера Езеро. Даты исходных снимков CTX в файле не указаны."
        ),
    )


def elevation_at(lon: float, lat: float) -> dict[str, Any] | None:
    """Value of the 20 m cell containing the point; None when the product does not cover it."""
    path = product_path()
    if not path.exists():
        return None
    tiff = geotiff.load(path, SOURCE)[0]
    cell = geotiff.sample(path, SOURCE, lon, lat, pixels_per_degree(tiff))
    if cell is None or cell["elevation_m"] is None:  # outside the mosaic, or a gap inside it
        return None
    return {
        **cell,
        "data_class": "REAL",
        "provenance_ids": [DATASET_ID],
        "resolution_m": RESOLUTION_M,
        "vertical_datum": VERTICAL_DATUM,
    }


def covering(west: float, south: float, east: float, north: float) -> Path | None:
    """The product file when it is acquired and contains the whole lon/lat box."""
    path = product_path()
    if not path.exists():
        return None
    tiff = geotiff.load(path, SOURCE)[0]
    ppd = pixels_per_degree(tiff)
    inside = geotiff.pixel_at(tiff, west, north, ppd) is not None and geotiff.pixel_at(tiff, east, south, ppd) is not None
    return path if inside else None


def grid(west: float, south: float, east: float, north: float, step: int) -> dict[str, Any]:
    """Every `step`-th cell of a lon/lat window (see geotiff.window_grid), with the product's provenance."""
    path = product_path()
    if not path.exists():
        raise AppError(
            503,
            "DATASET_NOT_ACQUIRED",
            "Рельеф CTX ещё не загружен: выполните python -m app.integrations.ctx_dtm.",
            {"dataset_id": DATASET_ID},
        )
    tiff, samples = geotiff.load(path, SOURCE)
    ppd = pixels_per_degree(tiff)
    g = geotiff.window_grid(tiff, samples, ppd, west, south, east, north, step, MAX_GRID_CELLS)
    if g is None:
        raise AppError(
            422,
            "OUTSIDE_COVERAGE",
            "Область выходит за пределы рельефа CTX.",
            {"dataset_id": DATASET_ID, "bbox": geotiff.bounds(tiff, ppd)},
        )
    spacing = step * tiff.pixel_scale
    return {
        "data_class": "REAL",
        "provenance_ids": [DATASET_ID],
        "resolution_m": RESOLUTION_M,
        "vertical_datum": VERTICAL_DATUM,
        **g,
        # The product is equirectangular with its true scale at the equator: a 20 m cell is
        # 20 m from north to south, but only 20 m x cos(latitude) on the ground from west to east.
        "cell_m": [spacing * math.cos(math.radians((g["north"] + g["south"]) / 2)), spacing],
    }


if __name__ == "__main__":  # python -m app.integrations.ctx_dtm
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        try:
            record = ingest(session, shared_client())
        except UpstreamError as exc:
            raise SystemExit(f"{exc.code}: {exc.message_ru} {exc.details}") from exc
        session.commit()
        print("ingested:", record.id, "->", record.raster_uri, record.extra_metadata["acquisition"]["size_px"])
