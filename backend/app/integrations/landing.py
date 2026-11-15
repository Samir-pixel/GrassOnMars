"""Landing-point check for the Marswalk start, and the regions a Marswalk can be planned in.

The limits are the engineering criteria NASA set for human landing sites (First Landing Site /
Exploration Zone Workshop for Human Missions to the Surface of Mars, 2015): within 50 degrees of
the equator, below +2 km MOLA elevation, generally level ground with slopes under about 10 degrees.
On top of them the cell must be LOW in the Stage 8 hazard model with no HIGH or UNKNOWN neighbour.
"""

from __future__ import annotations

import math
from typing import Any

from app.core.errors import AppError
from app.integrations import ctx_dtm, geotiff, hazard_detection as hd, mola
from app.integrations.route_planner import HIGH, LOW, UNKNOWN, Grid

MAX_ABS_LAT_DEG, MAX_ELEVATION_M, MAX_SLOPE_DEG = 50.0, 2000.0, 10.0
SOURCE = "NASA Human Landing Sites / Exploration Zones workshop, 2015"
JEZERO = {"id": "jezero", "west": 77.3, "south": 18.3, "east": 77.6, "north": 18.55, "step": 3}
JEZERO_LANDING = (18.4447, 77.4508, "Octavia E. Butler landing site (Perseverance, 2021)")


def _criteria(grid: Grid, i: int) -> list[dict[str, Any]]:
    _, lat = grid.lon_lat(i)
    r, c = divmod(i, grid.cols)
    around = [
        grid.hclass[rr * grid.cols + cc]
        for rr in range(max(0, r - 1), min(grid.rows, r + 2))
        for cc in range(max(0, c - 1), min(grid.cols, c + 2))
    ]
    known = grid.hclass[i] != UNKNOWN and math.isfinite(grid.elev[i]) and math.isfinite(grid.slope[i])
    return [
        {"id": "latitude", "ok": abs(lat) <= MAX_ABS_LAT_DEG, "value": round(lat, 4), "limit": MAX_ABS_LAT_DEG, "unit": "deg"},
        {"id": "elevation", "ok": known and grid.elev[i] <= MAX_ELEVATION_M, "value": round(grid.elev[i], 1) if known else None, "limit": MAX_ELEVATION_M, "unit": "m"},
        {"id": "slope", "ok": known and grid.slope[i] <= MAX_SLOPE_DEG, "value": round(grid.slope[i], 2) if known else None, "limit": MAX_SLOPE_DEG, "unit": "deg"},
        {"id": "hazard", "ok": grid.hclass[i] == LOW and HIGH not in around and UNKNOWN not in around,
         "value": ("UNKNOWN", "LOW", "MODERATE", "HIGH")[grid.hclass[i]], "limit": "LOW, no HIGH or UNKNOWN cell next to it", "unit": "class"},
    ]


def assess(grid: Grid, lat: float, lon: float) -> dict[str, Any]:
    """Does the cell under (lat, lon) meet the landing criteria, and if not, which nearest cell does."""
    cell = grid.cell_of(lat, lon)
    if cell is None:
        raise AppError(
            422, "OUTSIDE_COVERAGE", "Точка посадки вне сетки рельефа региона.", {"bbox": [grid.west, grid.south, grid.east, grid.north]}
        )
    criteria = _criteria(grid, cell)
    suitable = all(c["ok"] for c in criteria)
    nearest = None
    if not suitable:
        r0, c0 = divmod(cell, grid.cols)
        best = (math.inf, -1)
        for i in range(grid.rows * grid.cols):
            if grid.hclass[i] != LOW:
                continue
            r, c = divmod(i, grid.cols)
            d = math.hypot((c - c0) * grid.dx_m, (r - r0) * grid.dy_m)
            if d < best[0] and all(x["ok"] for x in _criteria(grid, i)):
                best = (d, i)
        if best[1] >= 0:
            n_lon, n_lat = grid.lon_lat(best[1])
            nearest = {
                "lat": round(n_lat, 6),
                "lon": round(n_lon, 6),
                "distance_m": round(best[0], 1),
                "elevation_m": round(grid.elev[best[1]], 1),
                "slope_deg": round(grid.slope[best[1]], 2),
            }
    c_lon, c_lat = grid.lon_lat(cell)
    return {
        "lat": round(c_lat, 6),
        "lon": round(c_lon, 6),
        "suitable": suitable,
        "criteria": criteria,
        "nearest_suitable": nearest,
        "data_class": "DERIVED",
        "provenance_ids": list(grid.provenance_ids),
        "cell_m": [round(grid.dx_m, 1), round(grid.dy_m, 1)],
        "criteria_source": SOURCE,
        "limitations": [
            f"Checked on {grid.dy_m:.0f} m cells of an orbital DEM: anything smaller than a cell is not resolved.",
            "The workshop also asks for few rocks, no thick dust and load-bearing ground; no dataset for these is loaded, so they are not checked.",
            "Meeting these criteria is a planning screen, not a guarantee of a safe landing.",
        ],
    }


def regions() -> list[dict[str, Any]]:
    """Windows a Marswalk can be planned in right now: Jezero on the CTX DTM, the other sites on their MOLA windows."""
    out = []
    if ctx_dtm.covering(JEZERO["west"], JEZERO["south"], JEZERO["east"], JEZERO["north"]) is not None:
        lat, lon, name = JEZERO_LANDING
        out.append({**JEZERO, "dataset_id": ctx_dtm.DATASET_ID, "resolution_m": ctx_dtm.RESOLUTION_M,
                    "landing": {"lat": lat, "lon": lon, "name": name}, "destinations": []})
    pad = 1 / mola.PIXELS_PER_DEGREE  # stay one cell inside the acquired window
    for site, (lat, lon, name) in mola.SITES.items():
        path = mola.subset_path(site)
        if not path.exists():
            continue
        west, south, east, north = geotiff.bounds(geotiff.load(path, mola.SOURCE)[0], mola.PIXELS_PER_DEGREE)
        window = {"west": round(west + pad, 6), "south": round(south + pad, 6), "east": round(east - pad, 6), "north": round(north - pad, 6)}
        named = hd.load_nomenclature((window["west"], window["south"], window["east"], window["north"]))
        named.sort(key=lambda f: hd._mars_dist_m(lat, lon, f["lat"], f["lon"]))
        out.append({
            "id": site, **window, "step": 1, "dataset_id": mola.DATASET_ID, "resolution_m": mola.RESOLUTION_M,
            "landing": {"lat": lat, "lon": lon, "name": name},
            # Named IAU features inside the window, nearest first: real places to walk to.
            "destinations": [
                {"name": f["name"], "feature_type": f["feature_type"], "lat": f["lat"], "lon": f["lon"], "diameter_km": f["diameter_km"]}
                for f in named[:6]
            ],
        })
    return out
