"""Unit and API tests for Stage 7 geospatial terrain analysis and CRISM layer."""

import base64
import math
import shutil
from array import array
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.errors import AppError
from app.integrations import crism, ctx_dtm, geotiff, terrain_analysis

FIXTURES = Path(__file__).parent / "fixtures"
NAN = float("nan")


@pytest.fixture()
def ctx_acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


def test_flat_plane_has_zero_slope_and_roughness() -> None:
    rows, cols = 5, 5
    elev = array("f", [-2500.0] * (rows * cols))
    res = terrain_analysis.compute_products(elev, rows, cols, 20.0, 20.0)
    assert all(v == pytest.approx(0.0, abs=1e-6) for v in res["slope"])
    assert all(v == pytest.approx(0.0, abs=1e-6) for v in res["roughness"])
    assert all(v == 1 for v in res["terrain_class"])
    expected_hs = round(math.sin(math.radians(40.0)) * 254.0) + 1
    assert all(v == expected_hs for v in res["hillshade"])


def test_tilted_plane_matches_analytical_slope_and_tri() -> None:
    rows, cols = 6, 6
    dx, dy = 18.0, 20.0
    gx, gy = 0.25, -0.15  # exact slope = atan(hypot(0.25, -0.15))
    elev = array("f", [gx * (c * dx) + gy * (r * dy) for r in range(rows) for c in range(cols)])
    res = terrain_analysis.compute_products(elev, rows, cols, dx, dy)
    expected_slope = math.degrees(math.atan(math.hypot(gx, gy)))
    assert all(s == pytest.approx(expected_slope, abs=1e-3) for s in res["slope"])
    # Interior 3x3 TRI on a linear plane = sqrt((2*dx^2*gx^2 + 2*dy^2*gy^2 + 2*(dx*gx+dy*gy)^2 + 2*(dx*gx-dy*gy)^2)/8)
    expected_tri = math.sqrt((6 * (dx * gx) ** 2 + 6 * (dy * gy) ** 2) / 8.0)
    assert res["roughness"][2 * cols + 2] == pytest.approx(expected_tri, abs=1e-3)


def test_nodata_is_preserved_across_all_derived_layers() -> None:
    rows, cols = 5, 5
    elev = array("f", [-2500.0] * (rows * cols))
    elev[2 * cols + 2] = NAN
    res = terrain_analysis.compute_products(elev, rows, cols, 20.0, 20.0)
    center = 2 * cols + 2
    assert math.isnan(res["slope"][center])
    assert math.isnan(res["roughness"][center])
    assert res["hillshade"][center] == 0
    assert res["terrain_class"][center] == 0
    # Neighbor adjacent to NoData also stays NoData instead of inventing a cliff.
    assert math.isnan(res["roughness"][center - 1])
    assert res["terrain_class"][center - 1] == 0
    # Far corner (0, 0) has clean 3x3 neighbors and stays valid.
    assert res["terrain_class"][0] == 1


def test_validate_dem_rejects_wrong_sphere_and_scales_dx_by_cos_lat(ctx_acquired) -> None:
    tiff, _ = geotiff.load(ctx_dtm.product_path(), "test")
    meta = terrain_analysis.validate_dem(tiff, 20.0, 18.44, step=3)
    assert meta["effective_spacing_m"][1] == 60.0
    assert meta["effective_spacing_m"][0] == pytest.approx(60.0 * math.cos(math.radians(18.44)), abs=0.01)
    assert meta["coarse_for_eva"] is False

    bad = geotiff.GeoTiff(**{**tiff.__dict__, "geo_keys": (1, 1, 0, 1, 2057, 0, 1, 6378137)})
    with pytest.raises(AppError) as err:
        terrain_analysis.validate_dem(bad, 20.0, 18.44)
    assert err.value.code == "INVALID_DEM_CRS"


def test_terrain_analysis_slope_profile_and_geotiff_export(client: TestClient, ctx_acquired) -> None:
    win = {"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530, "step": 2}
    res = client.get("/api/v1/terrain/analysis", params=win)
    assert res.status_code == 200
    body = res.json()
    assert body["data_class"] == "DERIVED"
    assert body["provenance_ids"] == ["mro_ctx_dtm_jezero_20m"]
    n = body["rows"] * body["cols"]
    assert len(array("f", base64.b64decode(body["slope_deg_f32_b64"]))) == n
    assert len(array("f", base64.b64decode(body["roughness_m_f32_b64"]))) == n
    assert len(base64.b64decode(body["hillshade_u8_b64"])) == n
    assert body["quality_report"]["valid_derived_cells"] > 0

    pt = client.get("/api/v1/terrain/slope", params={"lat": 18.4447, "lon": 77.4508})
    assert pt.status_code == 200
    assert pt.json()["data_class"] == "DERIVED"
    assert 0.0 <= pt.json()["slope_deg"] < 30.0
    assert pt.json()["coarse_for_eva"] is False

    prof = client.get(
        "/api/v1/terrain/profile",
        params={"start_lat": 18.440, "start_lon": 77.446, "end_lat": 18.449, "end_lon": 77.456},
    )
    assert prof.status_code == 200
    assert prof.json()["data_class"] == "DERIVED"
    assert len(prof.json()["points"]) == 48 and prof.json()["total_distance_m"] > 500

    tif_res = client.get("/api/v1/terrain/export", params={"layer": "slope", **win})
    assert tif_res.status_code == 200
    assert tif_res.headers["content-type"] == "image/tiff"
    raw = tif_res.content
    parsed = geotiff.open_geotiff(lambda o, l: raw[o : o + l], "export", "slope.tif")
    assert (parsed.width, parsed.height, parsed.typecode) == (body["cols"], body["rows"], "f")
    assert parsed.pixel_scale == pytest.approx(40.0)


def test_crism_ingest_and_layer_image_endpoint(client: TestClient) -> None:
    lbl = (
        "START_TIME = 2007-05-19T09:30:37.429\n"
        "  MAP_SCALE = 0.018\n"
        "  MINIMUM_LATITUDE = 18.364672\n"
        "  MAXIMUM_LATITUDE = 18.635047\n"
        "  WESTERNMOST_LONGITUDE = 77.279195\n"
        "  EASTERNMOST_LONGITUDE = 77.558793\n"
    ).encode("utf-8")
    png = crism.PNG_SIG + b"\x00\x00\x00\rIHDRstub"

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url) == crism.LBL_URL:
            return httpx.Response(200, content=lbl)
        if str(req.url) == crism.PNG_URL:
            return httpx.Response(200, content=png)
        return httpx.Response(404)

    with SessionLocal() as db:
        ds = crism.ingest(db, httpx.Client(transport=httpx.MockTransport(handler)))
        assert ds.id == crism.DATASET_ID
        assert ds.spatial_resolution_m == 18.0
        db.rollback()
