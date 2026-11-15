"""MGS MOLA elevation connector.

Product: MOLA MEGDR global DEM, USGS Astrogeology edition: 463 m (128 px/deg), 16-bit metres
above the areoid. Page: https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
The file is 2.13 GB with its tag directory at the end, so only the Jezero window is read with
HTTP Range requests and kept as a GeoTIFF subset outside the database.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.integrations import geotiff
from app.integrations.http import UpstreamError, shared_client
from app.models.geo import Dataset
from app.repositories.datasets import upsert_real_dataset

SOURCE = "USGS Astrogeology"
PRODUCT_ID = "Mars_MGS_MOLA_DEM_mosaic_global_463m"
URL = f"https://planetarymaps.usgs.gov/mosaic/{PRODUCT_ID}.tif"
PAGE_URL = "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m"
DATASET_ID = "mgs_mola_dem_463m"
RESOLUTION_M = 463.0835744  # as published on the product page
VERTICAL_DATUM = "MOLA areoid (gravity model GMM-2B)"
LICENSE_NOTE = (
    "CC0 (public domain), use constraints: none — as stated on the USGS Astrogeology product "
    "page. Credit: MOLA Team, NASA Goddard Space Flight Center; USGS Astrogeology Science Center."
)
# Published grid, exact: 46080 x 23040 samples over 360 x 180 degrees, planetocentric, +East.
PIXELS_PER_DEGREE = 128
# Jezero study area: footprint of the CTX DTM (77.16–77.70°E, 18.21–18.72°N) with a margin.
REGION = (77.0, 17.9, 78.2, 18.9)  # min_lon, min_lat, max_lon, max_lat
PLAUSIBLE_M = (-9000, 22000)  # wider than the relief of Mars; catches misread samples
TITLE = "MGS MOLA DEM 463 m"
MAX_GRID_CELLS = 400_000
# Marswalk regions outside Jezero: a 1 x 1 degree window (about 59 km north to south) around a landing point.
# Lander coordinates are planetocentric, +East, as NASA/NSSDCA publish them; the other points are the
# site centres of the comparison table. id -> (lat, lon, what the point is).
SITE_HALF_DEG = 0.5
SITES: dict[str, tuple[float, float, str]] = {
    "gale": (-4.5895, 137.4417, "Bradbury Landing (Curiosity, 2012)"),
    "gusev": (-14.5684, 175.4726, "Columbia Memorial Station (Spirit, 2004)"),
    "meridiani": (-1.9462, -5.5266, "Challenger Memorial Station (Opportunity, 2004)"),
    "elysium": (4.502, 135.623, "InSight landing site (2018)"),
    "utopia": (47.64, 134.29, "Viking 2 landing site (1976)"),
    "phoenix": (68.2188, -125.7492, "Phoenix landing site (2008)"),
    "arcadia": (47.0, -170.0, "Arcadia Planitia, site centre"),
    "deuteronilus": (44.0, 22.0, "Deuteronilus Mensae, site centre"),
    "hellas": (-40.5, 66.0, "Hellas Planitia, site centre"),
    "olympus": (17.34, -133.45, "Olympus Mons, site centre"),
    "valles": (-13.5, -61.0, "Valles Marineris, site centre"),
    "polar": (87.0, 15.0, "North polar cap, site centre"),
    "nili": (22.6, 76.8, "Nili Fossae, site centre"),
}


def subset_path(site: str = "jezero") -> Path:
    return settings.data_dir / "raw" / "mola" / f"{PRODUCT_ID}__{site}.tif"


def pixels_per_degree(tiff: geotiff.GeoTiff) -> float:
    return PIXELS_PER_DEGREE


def covering(west: float, south: float, east: float, north: float) -> Path | None:
    """The acquired window that contains the whole lon/lat box, if any."""
    for path in sorted(subset_path().parent.glob(f"{PRODUCT_ID}__*.tif")):
        tiff = geotiff.load(path, SOURCE)[0]
        if (
            geotiff.pixel_at(tiff, west, north, PIXELS_PER_DEGREE) is not None
            and geotiff.pixel_at(tiff, east, south, PIXELS_PER_DEGREE) is not None
        ):
            return path
    return None


def grid(west: float, south: float, east: float, north: float, step: int) -> dict[str, Any]:
    """Every `step`-th cell of a lon/lat window of an acquired MOLA window (see geotiff.window_grid)."""
    path = covering(west, south, east, north)
    if path is None:
        raise AppError(422, "OUTSIDE_COVERAGE", "Область вне загруженных окон MOLA.", {"dataset_id": DATASET_ID})
    tiff, samples = geotiff.load(path, SOURCE)
    g = geotiff.window_grid(tiff, samples, PIXELS_PER_DEGREE, west, south, east, north, step, MAX_GRID_CELLS)
    assert g is not None  # covering() checked both corners
    spacing = step * RESOLUTION_M
    return {
        "data_class": "REAL",
        "provenance_ids": [DATASET_ID],
        "resolution_m": RESOLUTION_M,
        "vertical_datum": VERTICAL_DATUM,
        **g,
        "cell_m": [spacing * math.cos(math.radians((g["north"] + g["south"]) / 2)), spacing],
    }


def acquire(
    client: httpx.Client, region: tuple[float, float, float, float] = REGION, site: str = "jezero"
) -> dict[str, Any]:
    """Read the region's window from the global file and store it. Returns its provenance."""
    read = geotiff.RangeReader(client, SOURCE, URL)
    tiff = geotiff.open_geotiff(read, SOURCE, URL)
    # The file's metre georeferencing implies a 3 396 263 m radius while its keys declare
    # 3 396 190 m, so the grid is addressed in degrees and must be the published global one.
    origin = (tiff.tie_x / tiff.pixel_scale, tiff.tie_y / tiff.pixel_scale)
    if (tiff.width, tiff.height, tiff.typecode) != (360 * PIXELS_PER_DEGREE, 180 * PIXELS_PER_DEGREE, "h") or not (
        math.isclose(origin[0], -180 * PIXELS_PER_DEGREE, abs_tol=1e-6)
        and math.isclose(origin[1], 90 * PIXELS_PER_DEGREE, abs_tol=1e-6)
    ):
        raise geotiff.invalid_data(SOURCE, URL, "not the published global 128 px/deg int16 grid")

    min_lon, min_lat, max_lon, max_lat = region
    top_left = geotiff.pixel_at(tiff, min_lon, max_lat, PIXELS_PER_DEGREE)
    bottom_right = geotiff.pixel_at(tiff, max_lon, min_lat, PIXELS_PER_DEGREE)
    if top_left is None or bottom_right is None:
        raise ValueError("region outside the grid")
    (col, row), (last_col, last_row) = top_left, bottom_right
    width, height = last_col - col + 1, last_row - row + 1
    samples = geotiff.read_window(tiff, read, col, row, width, height)
    valid = [v for v in samples if v != tiff.nodata]
    if not valid or min(valid) < PLAUSIBLE_M[0] or max(valid) > PLAUSIBLE_M[1]:
        raise geotiff.invalid_data(SOURCE, URL, "elevations outside the plausible range")

    path = subset_path(site)
    geotiff.write_subset(path, tiff, col, row, width, samples)
    west, north = geotiff.lon_lat_at(tiff, col, row, PIXELS_PER_DEGREE)
    east, south = geotiff.lon_lat_at(tiff, col + width, row + height, PIXELS_PER_DEGREE)
    etag, last_modified, size = read.stamp  # type: ignore[misc]
    return {
        "source_url": URL,
        "source_etag": etag,
        "source_last_modified": last_modified,
        "source_size_bytes": size,
        "byte_ranges": [list(r) for r in read.ranges],
        "window": {"col": col, "row": row, "width": width, "height": height},
        "bbox": [west, south, east, north],
        "pixel_scale_in_file_m": tiff.pixel_scale,
        "declared_semi_major_m": tiff.semi_major_m,
        "citation": tiff.citation,
        "nodata": tiff.nodata,
        "min_elevation_m": min(valid),
        "max_elevation_m": max(valid),
        "subset_path": path,
        "subset_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def ingest(db: Session, client: httpx.Client, region: tuple[float, float, float, float] = REGION) -> Dataset:
    """Acquire the window and write its provenance record. Caller commits."""
    info = acquire(client, region)
    path: Path = info.pop("subset_path")
    return upsert_real_dataset(
        db,
        DATASET_ID,
        step={
            "step": "acquire_region_window",
            "method": "HTTP Range requests; samples copied unchanged into a GeoTIFF subset",
            "window": info["window"],
            "subset_sha256": info["subset_sha256"],
        },
        metadata={"product_page": PAGE_URL, "acquisition": info},
        bbox=info["bbox"],
        title="MGS MOLA DEM 463 m (MEGDR, USGS edition) — Jezero window",
        mission_id="mgs",
        instrument_id="mola",
        provider=SOURCE,
        product_id=PRODUCT_ID,
        processing_level="MEGDR gridded DEM, USGS edition 2003-03-21",
        spatial_resolution_m=RESOLUTION_M,
        native_crs_wkt=info["citation"],
        vertical_datum=VERTICAL_DATUM,
        source_archive="USGS Astrogeology Science Center (Astropedia)",
        source_url=URL,
        raster_uri=path.relative_to(settings.data_dir.parent).as_posix(),
        sha256_checksum=info["subset_sha256"],
        license_note=LICENSE_NOTE,
        known_limitations=(
            "Сетка 463 м: пригодна для регионального контекста, но не для уклонов в масштабе выхода. "
            "По данным USGS, точность точек около 100 м в плане, суммарная погрешность высоты не менее ±3 м. "
            "Метровая привязка в файле соответствует радиусу 3 396 263 м при заявленных 3 396 190 м, "
            "поэтому сетка адресуется в градусах (128 пикселей на градус). "
            "Даты наблюдений в файле не указаны."
        ),
    )


def ingest_sites(db: Session, client: httpx.Client) -> Dataset:
    """Acquire the Marswalk site windows and add them to the product's provenance record. Caller commits."""
    windows = {}
    for site, (lat, lon, _) in SITES.items():
        info = acquire(client, (lon - SITE_HALF_DEG, lat - SITE_HALF_DEG, lon + SITE_HALF_DEG, lat + SITE_HALF_DEG), site)
        path: Path = info.pop("subset_path")
        windows[site] = {**info, "raster_uri": path.relative_to(settings.data_dir.parent).as_posix()}
    return upsert_real_dataset(
        db,
        DATASET_ID,
        step={
            "step": "acquire_site_windows",
            "method": "HTTP Range requests; samples copied unchanged into one GeoTIFF subset per site",
            "subset_sha256": {site: w["subset_sha256"] for site, w in windows.items()},
        },
        metadata={"site_windows": windows},
    )


def elevation_at(lon: float, lat: float) -> dict[str, Any]:
    """Value of the MOLA grid cell containing the point: a measured grid value, not an interpolation."""
    path = covering(lon, lat, lon, lat)
    if path is None:
        if not any(subset_path().parent.glob(f"{PRODUCT_ID}__*.tif")):
            raise AppError(
                503,
                "DATASET_NOT_ACQUIRED",
                "Высоты MOLA ещё не загружены: выполните python -m app.integrations.mola.",
                {"dataset_id": DATASET_ID},
            )
        raise AppError(422, "OUTSIDE_COVERAGE", "Точка вне загруженных окон высот MOLA.", {"dataset_id": DATASET_ID})
    cell = geotiff.sample(path, SOURCE, lon, lat, PIXELS_PER_DEGREE)
    assert cell is not None  # covering() found the point inside this window
    return {
        **cell,
        "data_class": "REAL",
        "provenance_ids": [DATASET_ID],
        "resolution_m": RESOLUTION_M,
        "vertical_datum": VERTICAL_DATUM,
    }


if __name__ == "__main__":  # python -m app.integrations.mola
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        try:
            record = ingest(session, shared_client())
            ingest_sites(session, shared_client())
        except UpstreamError as exc:
            raise SystemExit(f"{exc.code}: {exc.message_ru} {exc.details}") from exc
        session.commit()
        print("ingested:", record.id, "->", record.raster_uri, record.extra_metadata["acquisition"]["window"])
