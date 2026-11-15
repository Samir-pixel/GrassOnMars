"""Marswalk regions outside Jezero (MOLA windows) and the landing-point check with its nearest suitable cell."""

import shutil
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.integrations import ctx_dtm, landing, mola, route_planner as rp, terrain_analysis as ta
from tests.test_route_planner import flat, make_grid

FIXTURES = Path(__file__).parent / "fixtures"
WINDOW = {"west": 77.1, "south": 18.0, "east": 78.1, "north": 18.8, "step": 1}  # inside the MOLA fixture, wider than CTX


@pytest.fixture()
def mola_site(monkeypatch) -> None:
    """The real MOLA Jezero window stored as a Marswalk site; no CTX product is present."""
    monkeypatch.setattr(mola, "SITES", {"testsite": (18.4, 77.6, "Test landing point")})
    path = mola.subset_path("testsite")
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "mola_jezero_window.tif", path)


def criteria(result: dict) -> dict[str, bool]:
    return {c["id"]: c["ok"] for c in result["criteria"]}


def test_flat_low_ground_is_suitable_and_needs_no_alternative() -> None:
    result = landing.assess(make_grid(flat(9, 9)), 0.5, 0.5)
    assert result["suitable"] is True and result["nearest_suitable"] is None
    assert criteria(result) == {"latitude": True, "elevation": True, "slope": True, "hazard": True}
    assert any("not a guarantee" in text for text in result["limitations"])


def test_steep_cell_fails_slope_and_the_nearest_passing_cell_is_offered() -> None:
    rows = flat(9, 9)
    for r in range(9):  # a 25 m step between columns 3 and 4: both are steep, columns 2 and 5 are flat again
        for c in range(4):
            rows[r][c] += 25.0
    grid = make_grid(rows)
    result = landing.assess(grid, 0.5, 0.39)  # row 4, column 3
    assert result["suitable"] is False and criteria(result)["slope"] is False
    near = result["nearest_suitable"]
    cell = grid.cell_of(near["lat"], near["lon"])
    assert divmod(cell, 9) == (4, 2)  # one cell west on the same row; column 5 is two cells away
    assert near["distance_m"] == pytest.approx(20.0) and near["slope_deg"] <= landing.MAX_SLOPE_DEG
    assert landing.assess(grid, near["lat"], near["lon"])["suitable"] is True


def test_cell_next_to_high_hazard_or_missing_data_is_not_a_landing_point() -> None:
    grid = make_grid(flat(9, 9), high=(40,))
    assert criteria(landing.assess(grid, 0.5, 0.5))["hazard"] is False  # the HIGH cell itself
    beside = landing.assess(grid, 0.5, 0.61)  # column 5, next to it
    assert beside["suitable"] is False and criteria(beside) == {"latitude": True, "elevation": True, "slope": True, "hazard": False}
    assert beside["nearest_suitable"]["distance_m"] == pytest.approx(20.0)

    rows = flat(9, 9)
    rows[4][4] = float("nan")
    gap = landing.assess(make_grid(rows), 0.5, 0.5)
    assert gap["suitable"] is False and criteria(gap)["elevation"] is False and criteria(gap)["slope"] is False


def test_region_outside_nasa_limits_has_no_suitable_cell_at_all() -> None:
    polar = replace(make_grid(flat(6, 6)), south=60.0, north=61.0)
    result = landing.assess(polar, 60.5, 0.5)
    assert criteria(result)["latitude"] is False and result["nearest_suitable"] is None
    high = landing.assess(make_grid([[2500.0] * 6 for _ in range(6)]), 0.5, 0.5)
    assert criteria(high)["elevation"] is False and high["nearest_suitable"] is None
    with pytest.raises(Exception) as err:
        landing.assess(make_grid(flat(6, 6)), 5.0, 0.5)
    assert err.value.code == "OUTSIDE_COVERAGE"


def test_roughness_thresholds_scale_with_cell_spacing() -> None:
    # The same 2 degree plane: 16 m between neighbours on 463 m cells is not "steep" terrain, it is the cell size.
    plane = [-2500.0 + r * 463.08 * 0.0349 for r in range(5) for _ in range(5)]
    assert ta.compute_products(plane, 5, 5, 440.0, 463.08)["terrain_class"][12] == 1
    assert ta.relief_scale(60.0) == ta.relief_scale(20.0) == 1.0  # the CTX analysis grids are unchanged


def test_window_outside_ctx_is_analysed_on_the_mola_window(mola_site) -> None:
    a = ta.analyze_window(**WINDOW)
    assert a["provenance_ids"] == ["mgs_mola_dem_463m"]
    assert a["cell_m"][1] == pytest.approx(463.08, abs=0.01) and a["metadata"]["coarse_for_eva"] is True
    assert a["metadata"]["dem"] == "MGS MOLA DEM 463 m"
    grid = rp.terrain_grid(**WINDOW)
    assert grid.tri_scale == pytest.approx(463.08 / 60, abs=0.01)
    assert rp.LOW in grid.hclass  # the scaled thresholds leave gentle MOLA cells LOW instead of marking every cell rough
    with pytest.raises(Exception) as err:
        ta.analyze_window(10.0, 10.0, 10.5, 10.5, 1)
    assert err.value.code == "DATASET_NOT_ACQUIRED"  # no DEM at all there; with CTX on disk it would be OUTSIDE_COVERAGE


def test_regions_landing_and_route_endpoints_on_a_mola_site(client: TestClient, mola_site) -> None:
    regions = client.get("/api/v1/terrain/regions").json()
    assert [r["id"] for r in regions] == ["testsite"]  # no CTX product on disk, so no Jezero region
    region = regions[0]
    assert (region["dataset_id"], region["step"], region["landing"]["name"]) == ("mgs_mola_dem_463m", 1, "Test landing point")
    window = {k: region[k] for k in ("west", "south", "east", "north", "step")}

    check = client.get("/api/v1/landing/assess", params={"lat": 18.4, "lon": 77.6, **window})
    assert check.status_code == 200
    body = check.json()
    assert body["data_class"] == "DERIVED" and body["provenance_ids"][0] == "mgs_mola_dem_463m"
    assert body["suitable"] or body["nearest_suitable"] is not None  # Jezero's floor has landable MOLA cells

    plan = client.post(
        "/api/v1/routes/plan",
        json={"start": {"lat": 18.40, "lon": 77.60}, "destination": {"lat": 18.45, "lon": 77.70}, "modes": ["SHORTEST"], **window},
    )
    assert plan.status_code == 200
    assert plan.json()["alternatives"][0]["status"] == "found"
    assert any("MOLA cells: regional planning only" in w for w in plan.json()["warnings"])

    point = client.get("/api/v1/hazards/assess", params={"lat": 18.4, "lon": 77.9}).json()
    assert point["detection_method"].startswith("MOLA 463 m") and "mro_ctx_dtm_jezero_20m" not in point["observation_dates"]


def test_jezero_region_is_listed_only_when_ctx_covers_its_window(client: TestClient) -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)  # a 64-cell sample, far smaller than the Jezero window
    assert client.get("/api/v1/terrain/regions").json() == []
