"""Stage 9 route planner: synthetic rasters with known answers, then the endpoint on the CTX fixture."""

import math
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.integrations import ctx_dtm, route_planner as rp, terrain_analysis as ta

FIXTURES = Path(__file__).parent / "fixtures"
NAN = float("nan")


def make_grid(elev_rows: list[list[float]], *, high: tuple[int, ...] = (), dx: float = 20.0, dy: float = 20.0) -> rp.Grid:
    """A raster over lon 0..1, lat 0..1 with Stage 7 products; hazard is LOW except the `high` cells."""
    rows, cols = len(elev_rows), len(elev_rows[0])
    elev = [v for row in elev_rows for v in row]
    prod = ta.compute_products(elev, rows, cols, dx, dy)
    hclass = bytearray(rp.LOW if math.isfinite(s) else rp.UNKNOWN for s in prod["slope"])
    for i in high:
        hclass[i] = rp.HIGH
    return rp.Grid(
        rows, cols, dx, dy, 0.0, 0.0, 1.0, 1.0, elev, list(prod["slope"]), list(prod["roughness"]),
        prod["terrain_class"], bytes(hclass), bytes(255 if h == rp.HIGH else 0 for h in hclass), bytes(rows * cols),
    )  # fmt: skip


def flat(rows: int, cols: int) -> list[list[float]]:
    return [[-2500.0] * cols for _ in range(rows)]


def cells(alt: dict, grid: rp.Grid) -> list[int]:
    return [grid.cell_of(lat, lon) for lon, lat in alt["geometry"]["coordinates"]]


def by_mode(alts: list[dict]) -> dict[str, dict]:
    return {a["mode"]: a for a in alts}


def test_flat_terrain_gives_one_straight_route_with_real_ground_distance() -> None:
    grid = make_grid(flat(10, 10), dx=10.0)  # west-east cells are half as long on the ground as north-south
    east = by_mode(rp.plan(grid, 50, 59))
    assert all(a["status"] == "found" for a in east.values())
    assert east["SHORTEST"]["total_distance_m"] == pytest.approx(9 * 10.0)
    assert east["SHORTEST"]["ascent_m"] == east["SHORTEST"]["max_slope_deg"] == 0
    assert east["LOWEST_TERRAIN_RISK"]["same_route_as"] == east["SCIENCE_PRIORITY"]["same_route_as"] == "SHORTEST"
    south = rp.plan(grid, 5, 95, ["SHORTEST"])[0]
    assert south["total_distance_m"] == pytest.approx(9 * 20.0)  # the same nine steps, twice the metres
    diagonal = rp.plan(grid, 0, 99, ["SHORTEST"])[0]
    assert diagonal["total_distance_m"] == pytest.approx(9 * math.hypot(10.0, 20.0), abs=0.1)
    assert not any(k in diagonal for k in ("duration_s", "speed", "oxygen", "energy"))


def ridge_grid() -> rp.Grid:
    """A 8 m ridge along column 10 on rows 0..7; rows 9..11 are a flat pass around its southern end."""
    rows = flat(12, 21)
    for r in range(8):
        rows[r][10] += 8.0
    return make_grid(rows)


def test_sloped_terrain_shortest_climbs_the_ridge_and_risk_route_goes_round() -> None:
    grid = ridge_grid()
    alts = by_mode(rp.plan(grid, 2 * 21, 2 * 21 + 20))
    short, safe = alts["SHORTEST"], alts["LOWEST_TERRAIN_RISK"]
    assert short["max_slope_deg"] > 10 and short["ascent_m"] == pytest.approx(8.0)
    assert short["total_distance_m"] == pytest.approx(18 * 20 + 2 * math.hypot(20, 8), abs=0.1)  # dz counts
    assert safe["max_slope_deg"] == 0 and safe["ascent_m"] == 0
    assert safe["total_distance_m"] > short["total_distance_m"]
    assert safe["same_route_as"] is None and safe["extra_distance_vs_shortest_m"] > 0
    assert "longer" in safe["explanation"] and "max slope 0.0 vs" in safe["explanation"]
    assert safe["cost"]["slope"] == 0 and short["cost"]["total"] == pytest.approx(short["total_distance_m"], abs=0.1)


def test_dijkstra_reference_agrees_with_a_star_and_weights_are_configurable() -> None:
    grid = ridge_grid()
    start, goal = 2 * 21, 2 * 21 + 20
    targets = [{"id": "t", "name": "t", "rover_sol": 1, "lat": 1 - 5.5 / 12, "lon": (c + 0.5) / 21} for c in range(4, 17)]
    a_star = rp.plan(grid, start, goal, targets=targets, science_radius_m=60)
    dijkstra = rp.plan(grid, start, goal, targets=targets, science_radius_m=60, algorithm="dijkstra")
    for a, d in zip(a_star, dijkstra):
        assert a["cost"]["total"] == pytest.approx(d["cost"]["total"], abs=0.05)
        assert a["nodes_expanded"] <= d["nodes_expanded"]
    no_terrain = {"slope": 0.0, "roughness": 0.0, "hazard": 0.0, "uncertainty": 0.0}
    relaxed = rp.plan(grid, start, goal, ["LOWEST_TERRAIN_RISK"], weights={"LOWEST_TERRAIN_RISK": no_terrain})[0]
    assert relaxed["same_route_as"] == "SHORTEST"


def test_obstacle_on_flat_ground_is_avoided_only_where_it_is_a_constraint() -> None:
    wall = tuple(r * 11 + 5 for r in range(8))  # HIGH-hazard cells across the straight line
    grid = make_grid(flat(11, 11), high=wall)
    alts = by_mode(rp.plan(grid, 3 * 11, 3 * 11 + 10))
    assert alts["SHORTEST"]["hazard"]["high_cells"] == 1  # terrain is not weighed: it says so and reports the cell
    assert "1 HIGH-hazard cells" in alts["SHORTEST"]["explanation"]
    safe = alts["LOWEST_TERRAIN_RISK"]
    assert safe["hazard"]["high_cells"] == 0 and not set(cells(safe, grid)) & set(wall)
    assert safe["total_distance_m"] > alts["SHORTEST"]["total_distance_m"]
    sci = alts["SCIENCE_PRIORITY"]  # there hazard is a cost, not a ban: one cell is cheaper than the detour, and it shows
    assert sci["hazard"]["high_cells"] == 1 and sci["cost"]["hazard"] > 0


def test_missing_dem_cells_are_never_crossed() -> None:
    rows = flat(11, 11)
    for r in range(7):
        rows[r][5] = NAN
    grid = make_grid(rows)
    for alt in rp.plan(grid, 3 * 11, 3 * 11 + 10):
        assert alt["status"] == "found"
        assert all(grid.hclass[i] != rp.UNKNOWN and math.isfinite(grid.elev[i]) for i in cells(alt, grid))
        assert alt["total_distance_m"] > 10 * 20  # round the gap and the cells whose slope it makes unknown
    on_gap = rp.plan(grid, 3 * 11 + 5, 3 * 11 + 10, ["SHORTEST"])[0]
    assert on_gap["status"] == "unreachable" and "NoData" in on_gap["reason"] and "geometry" not in on_gap


def test_unreachable_destination_is_reported_not_forced() -> None:
    rows = flat(8, 11)
    for r in range(8):
        rows[r][5] = NAN
    cut = rp.plan(make_grid(rows), 3 * 11, 3 * 11 + 10)
    assert [a["status"] for a in cut] == ["unreachable"] * 3 and "separated" in cut[0]["reason"]

    fenced = by_mode(rp.plan(make_grid(flat(8, 11), high=tuple(r * 11 + 5 for r in range(8))), 3 * 11, 3 * 11 + 10))
    assert fenced["SHORTEST"]["status"] == "found"
    assert fenced["LOWEST_TERRAIN_RISK"]["status"] == "unreachable" and "HIGH hazard" in fenced["LOWEST_TERRAIN_RISK"]["reason"]

    steep = by_mode(rp.plan(ridge_grid(), 2 * 21, 2 * 21 + 20, max_slope_deg=5.0))
    assert steep["SHORTEST"]["max_slope_deg"] <= 5.0  # the limit binds every mode, so the shortest goes round too


def test_science_route_is_an_alternative_but_never_through_hazard() -> None:
    track = [{"id": f"wp{c}", "name": f"wp{c}", "rover_sol": c, "lat": 1 - 7.5 / 12, "lon": (c + 0.5) / 25} for c in range(4, 21)]
    grid = make_grid(flat(12, 25))
    alts = by_mode(rp.plan(grid, 2 * 25, 2 * 25 + 24, targets=track, science_radius_m=60))
    short, sci = alts["SHORTEST"], alts["SCIENCE_PRIORITY"]
    assert short["science_targets"] == [] and len(sci["science_targets"]) > 5
    assert sci["science_targets"][0]["distance_to_route_m"] <= 60
    assert sci["extra_distance_vs_shortest_m"] > 0 and sci["cost"]["science_discount"] > 0
    assert sci["cost"]["total"] < short["total_distance_m"]  # the detour is cheaper than the straight line under its weights

    hazardous = make_grid(flat(12, 25), high=tuple(r * 25 + c for r in (6, 7, 8) for c in range(25)))
    sci = by_mode(rp.plan(hazardous, 2 * 25, 2 * 25 + 24, targets=track, science_radius_m=60))["SCIENCE_PRIORITY"]
    assert sci["hazard"]["high_cells"] == 0  # it comes as near as LOW-hazard ground allows and stops there
    assert min(t["distance_to_route_m"] for t in sci["science_targets"]) >= 40


@pytest.fixture()
def ctx_acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


def test_route_plan_endpoint_on_ctx_terrain(client: TestClient, ctx_acquired) -> None:
    window = {"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530, "step": 2}
    body = {"start": {"lat": 18.440, "lon": 77.446}, "destination": {"lat": 18.449, "lon": 77.456}, **window}
    res = client.post("/api/v1/routes/plan", json=body)
    assert res.status_code == 200
    plan = res.json()
    assert plan["data_class"] == "DERIVED" and "mro_ctx_dtm_jezero_20m" in plan["provenance_ids"]
    assert [a["mode"] for a in plan["alternatives"]] == list(rp.MODES)
    assert plan["start"]["snapped_m"] < 40 and plan["start"]["elevation_m"] < 0
    assert "Cost = D *" in plan["cost_model"]["formula"] and any("duration" in s for s in plan["limitations"])
    for alt in plan["alternatives"]:
        assert alt["status"] == "found" and alt["explanation"]
        line = alt["geometry"]["coordinates"]
        assert len(line) == len(alt["elevation_profile"]) > 10
        straight = ta._mars_dist_m(line[0][1], line[0][0], line[-1][1], line[-1][0])
        assert straight <= alt["total_distance_m"] < 1.5 * straight  # metres on Mars, not degrees
        assert alt["elevation_profile"][-1]["distance_m"] == alt["total_distance_m"]
        assert sum(alt["terrain"]["class_share"].values()) == pytest.approx(1, abs=0.01)
    reference = client.post("/api/v1/routes/plan", json={**body, "algorithm": "dijkstra"}).json()
    for a, d in zip(plan["alternatives"], reference["alternatives"]):
        assert a["cost"]["total"] == pytest.approx(d["cost"]["total"], abs=0.05)

    outside = client.post("/api/v1/routes/plan", json={**body, "destination": {"lat": 18.60, "lon": 77.456}})
    assert outside.status_code == 422 and outside.json()["error"]["code"] == "OUTSIDE_COVERAGE"
    same = client.post("/api/v1/routes/plan", json={**body, "destination": body["start"]})
    assert same.status_code == 422 and same.json()["error"]["code"] == "SAME_CELL"
