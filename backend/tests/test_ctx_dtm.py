"""CTX DTM connector tests.

Fixture ctx_dtm_landing_64px.tif: 64 x 64 real cells around the Perseverance landing site, cut on
2026-11-14 from the USGS product JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m (the full
product is 9.7 MB). In the acquisition tests it stands in for the complete remote file.
"""

import base64
import hashlib
import math
import re
import shutil
from array import array
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.integrations import ctx_dtm, geotiff, mola
from app.integrations.http import UpstreamError

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE = (FIXTURES / "ctx_dtm_landing_64px.tif").read_bytes()
LANDING = {"lon": 77.45088572, "lat": 18.44462715}  # first Perseverance waypoint, elev_geoid -2569.91 m


def usgs_client(total: int = len(SAMPLE)) -> tuple[httpx.Client, list[str]]:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == ctx_dtm.URL
        seen.append(request.headers["Range"])
        first, last = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers["Range"]).groups())
        body = SAMPLE[first : last + 1]
        return httpx.Response(
            206,
            content=body,
            headers={"Content-Range": f"bytes {first}-{first + len(body) - 1}/{total}", "ETag": '"ctx"'},
        )

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


@pytest.fixture()
def acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


def test_product_is_stored_unchanged() -> None:
    client, _ = usgs_client()
    info = ctx_dtm.acquire(client)
    assert ctx_dtm.product_path().read_bytes() == SAMPLE
    assert info["sha256"] == hashlib.sha256(SAMPLE).hexdigest()
    assert info["size_px"] == [64, 64]
    assert info["cells_with_data"] == 64 * 64
    assert -2700 < info["min_elevation_m"] < info["max_elevation_m"] < -2400  # crater floor near the delta


def test_oversized_file_is_refused_before_download() -> None:
    client, seen = usgs_client(total=2_000_000_000)
    with pytest.raises(UpstreamError) as err:
        ctx_dtm.acquire(client)
    assert err.value.code == "UPSTREAM_INVALID_DATA"
    assert len(seen) == 1  # only the directory read
    assert not ctx_dtm.product_path().exists()


def test_elevation_is_the_real_cell_value(acquired) -> None:
    sample = ctx_dtm.elevation_at(**LANDING)
    assert sample["elevation_m"] == pytest.approx(-2567.19, abs=0.01)  # 2.7 m from the rover's own value
    assert sample["resolution_m"] == 20.0
    assert sample["provenance_ids"] == ["mro_ctx_dtm_jezero_20m"]
    assert abs(sample["pixel_lon"] - LANDING["lon"]) < 20 / 59274.7  # the cell centre is within one cell
    assert ctx_dtm.elevation_at(lon=77.60, lat=18.44) is None  # outside the 64-cell sample


def test_pixels_per_degree_matches_the_product_page(acquired) -> None:
    tiff = geotiff.load(ctx_dtm.product_path(), "test")[0]
    assert ctx_dtm.pixels_per_degree(tiff) == pytest.approx(2963.7349, abs=1e-4)


def test_ingest_fills_the_catalogue_row() -> None:
    client, _ = usgs_client()
    with SessionLocal() as db:
        dataset = ctx_dtm.ingest(db, client)
        assert (dataset.data_class, dataset.integration_status) == ("REAL", "integrated")
        assert dataset.doi == "10.5066/P906QQT8"
        assert "Please cite authors" in dataset.license_note
        assert dataset.source_url == ctx_dtm.URL
        assert dataset.raster_uri.endswith("raw/ctx/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif")
        assert dataset.native_crs_wkt.startswith("Equirectangular Mars 2000 Sphere IAU")
        assert "note_ru" not in dataset.extra_metadata  # the "not connected yet" placeholder is gone
        assert [h["step"] for h in dataset.processing_history][-1] == "download_product"
        db.rollback()  # the test leaves the database untouched


def test_terrain_point_prefers_the_finest_grid(client: TestClient, acquired) -> None:
    path = mola.subset_path()
    path.parent.mkdir(parents=True)
    shutil.copy(FIXTURES / "mola_jezero_window.tif", path)

    fine = client.get("/api/v1/terrain/point", params=LANDING).json()
    assert (fine["resolution_m"], fine["provenance_ids"]) == (20.0, ["mro_ctx_dtm_jezero_20m"])
    coarse = client.get("/api/v1/terrain/point", params={"lat": 18.40, "lon": 77.90}).json()
    assert (coarse["elevation_m"], coarse["provenance_ids"]) == (-2621.0, ["mgs_mola_dem_463m"])


@pytest.mark.parametrize("step", [1, 3])
def test_heightmap_cells_are_real_cells_at_their_reported_place(client: TestClient, acquired, step: int) -> None:
    window = {"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530}
    grid = client.get("/api/v1/terrain/heightmap", params={**window, "step": step}).json()
    rows, cols = grid["rows"], grid["cols"]
    values = array("f", base64.b64decode(grid["elevation_f32_b64"]))
    assert len(values) == rows * cols and min(rows, cols) >= 50 // step
    assert (grid["data_class"], grid["provenance_ids"]) == ("REAL", ["mro_ctx_dtm_jezero_20m"])
    assert grid["west"] <= window["west"] and grid["north"] >= window["north"]  # starts at the cell holding the corner
    # A consumer that places sample (r, c) at the centre of its cell of the reported bounds
    # finds the very value the point endpoint returns there.
    for r, c in [(0, 0), (rows - 1, cols - 1), (rows // 2, cols // 3)]:
        lat = grid["north"] - (r + 0.5) / rows * (grid["north"] - grid["south"])
        lon = grid["west"] + (c + 0.5) / cols * (grid["east"] - grid["west"])
        assert values[r * cols + c] == pytest.approx(ctx_dtm.elevation_at(lon=lon, lat=lat)["elevation_m"])
    assert grid["cell_m"][1] == 20.0 * step
    assert grid["cell_m"][0] == pytest.approx(20.0 * step * math.cos(math.radians(18.4445)), rel=1e-4)


def test_heightmap_refuses_what_it_cannot_serve(client: TestClient, acquired, monkeypatch) -> None:
    inside = {"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530}
    outside = client.get("/api/v1/terrain/heightmap", params={**inside, "east": 77.60})
    assert (outside.status_code, outside.json()["error"]["code"]) == (422, "OUTSIDE_COVERAGE")
    flipped = client.get("/api/v1/terrain/heightmap", params={**inside, "west": 77.4600, "east": 77.4420})
    assert (flipped.status_code, flipped.json()["error"]["code"]) == (422, "GRID_SIZE")
    monkeypatch.setattr(ctx_dtm, "MAX_GRID_CELLS", 100)
    large = client.get("/api/v1/terrain/heightmap", params=inside)
    assert (large.status_code, large.json()["error"]["code"]) == (422, "GRID_SIZE")
    ctx_dtm.product_path().unlink()
    missing = client.get("/api/v1/terrain/heightmap", params=inside)
    assert (missing.status_code, missing.json()["error"]["code"]) == (503, "DATASET_NOT_ACQUIRED")


@pytest.mark.live
def test_live_ctx_dtm_directory() -> None:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        read = geotiff.RangeReader(client, ctx_dtm.SOURCE, ctx_dtm.URL)
        tiff = geotiff.open_geotiff(read, ctx_dtm.SOURCE, ctx_dtm.URL)
    assert (tiff.width, tiff.height, tiff.typecode, tiff.pixel_scale) == (1596, 1512, "f", 20.0)
    assert read.stamp[2] == 9_662_387
    assert len(read.ranges) == 1
