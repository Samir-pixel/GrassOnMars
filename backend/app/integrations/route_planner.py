"""Stage 9: route planning over the Jezero terrain raster (A*, with Dijkstra as the reference).

Graph: one node per traversable raster cell, 8-connected. Cost of one step, in weighted metres:
    Cost = D * (w_d + w_s*S + w_t*T + w_r*R + w_u*U - w_v*V)
D  ground distance of the step in metres: cell spacing (west-east already scaled by cos(lat)) plus dz;
S  slope / 18 deg and T  TRI roughness / 6 m (the Stage 8 reference values), clamped to 0..1;
R  Stage 8 hazard risk score, U  Stage 8 data uncertainty, V  proximity to a science target (0..1).
S, T, R, U, V of a step are the mean of its two cells. Weights are dimensionless planning preferences.

No traverse speed, duration, oxygen or energy is modelled: no validated Mars EVA model is integrated.
"""

from __future__ import annotations

import base64
import heapq
import math
import sys
from array import array
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.integrations import hazard_detection as hd, terrain_analysis as ta

MODES = ("SHORTEST", "LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY")
PRESETS: dict[str, dict[str, float]] = {
    "SHORTEST": {"distance": 1.0, "slope": 0.0, "roughness": 0.0, "hazard": 0.0, "uncertainty": 0.0, "science": 0.0},
    "LOWEST_TERRAIN_RISK": {"distance": 1.0, "slope": 4.0, "roughness": 2.0, "hazard": 4.0, "uncertainty": 2.0, "science": 0.0},
    "SCIENCE_PRIORITY": {"distance": 1.0, "slope": 1.0, "roughness": 0.5, "hazard": 1.0, "uncertainty": 0.5, "science": 0.6},
}
TERMS = ("slope", "roughness", "hazard", "uncertainty")
SLOPE_REF_DEG, TRI_REF_M = hd.RiskConfig().slope_high_deg, hd.RiskConfig().tri_high_m
MAX_SCIENCE_DISCOUNT = 0.8  # science waives at most 80% of the distance term, so every step still costs something
UNKNOWN, LOW, HIGH = (hd.CLASS_CODE[k] for k in ("UNKNOWN", "LOW", "HIGH"))
TERRAIN_CLASSES = ("smooth", "moderate", "steep", "hazard")  # Stage 7 codes 1..4
HAZARD_CLASSES = ("LOW", "MODERATE", "HIGH")  # Stage 8 codes 1..3
BLOCK_REASON = {1: "NoData (no elevation, slope or roughness)", 2: "slope above the requested limit", 3: "HIGH hazard class (forbidden zone)"}
MOVES = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]

COST_MODEL = {
    "formula": "Cost = D * (w_distance + w_slope*S + w_roughness*T + w_hazard*R + w_uncertainty*U - w_science*V)",
    "units": "weighted metres; weights are dimensionless planning preferences, not physical quantities",
    "terms": {
        "D": "ground distance of a step, m: cell spacing (west-east scaled by cos(latitude)) combined with the elevation difference",
        "S": f"cell slope / {SLOPE_REF_DEG:g} deg, clamped to 0..1 (Stage 8 high-slope reference)",
        "T": f"3x3 TRI roughness / {TRI_REF_M:g} m, clamped to 0..1 (Stage 8 roughness reference)",
        "R": "Stage 8 hazard risk score, 0..1",
        "U": "Stage 8 data uncertainty, 0..1 (coverage of HiRISE and CRISM; a 20 m DTM never reaches 0)",
        "V": "proximity to a science target, 1 at the target falling to 0 at the science radius; "
        f"only on LOW-hazard cells, and it waives at most {MAX_SCIENCE_DISCOUNT:.0%} of the distance term",
    },
}
LIMITATIONS = [
    "Routes join cell centres of the DEM grid (CTX 20 m subsampled, or MOLA 463 m outside Jezero); obstacles smaller than a cell (boulders, ledges, ripples) are not resolved.",
    "Steps are 8-connected, so a route can be up to about 8% longer than a free-angle path over the same ground.",
    "Slope is the cell's steepest gradient, not the grade along the direction of travel.",
    "West-east spacing uses cos(latitude) at the centre of the window.",
    "Science value is proximity to Perseverance waypoints (REAL positions); it does not rate their scientific merit.",
    "No traverse duration, speed, oxygen or energy is estimated: no validated Mars EVA model is integrated.",
    hd.HAZARD_DISCLAIMER,
]


@dataclass(frozen=True)
class Grid:
    rows: int
    cols: int
    dx_m: float  # west-east spacing on the ground
    dy_m: float
    west: float
    south: float
    east: float
    north: float
    elev: list[float]
    slope: list[float]
    tri: list[float]
    tclass: bytes  # Stage 7 terrain class, 0 = NoData
    hclass: bytes  # Stage 8 hazard class, 0 = UNKNOWN
    risk: bytes  # Stage 8 risk score, 0..255
    unc: bytes  # Stage 8 data uncertainty, 0..255
    provenance_ids: tuple[str, ...] = ()
    tri_scale: float = 1.0  # ta.relief_scale of the cell spacing: TRI in metres grows with it

    def cell_of(self, lat: float, lon: float) -> int | None:
        c = math.floor((lon - self.west) / (self.east - self.west) * self.cols)
        r = math.floor((self.north - lat) / (self.north - self.south) * self.rows)
        return r * self.cols + c if 0 <= r < self.rows and 0 <= c < self.cols else None

    def xy_m(self, lat: float, lon: float) -> tuple[float, float]:
        return (
            (lon - self.west) / (self.east - self.west) * self.cols * self.dx_m,
            (self.north - lat) / (self.north - self.south) * self.rows * self.dy_m,
        )

    def lon_lat(self, i: int) -> tuple[float, float]:
        r, c = divmod(i, self.cols)
        return (
            self.west + (c + 0.5) / self.cols * (self.east - self.west),
            self.north - (r + 0.5) / self.rows * (self.north - self.south),
        )


def _f32(b64: str) -> list[float]:
    out = array("f")
    out.frombytes(base64.b64decode(b64))
    if sys.byteorder == "big":
        out.byteswap()
    return out.tolist()


@lru_cache(maxsize=4)
def _cached_grid(west: float, south: float, east: float, north: float, step: int, mtime_ns: int) -> Grid:
    a = ta.analyze_window(west, south, east, north, step)
    h = hd._grid_arrays(west, south, east, north, step, hd.RiskConfig())
    return Grid(
        rows=a["rows"],
        cols=a["cols"],
        dx_m=a["cell_m"][0],
        dy_m=a["cell_m"][1],
        west=a["west"],
        south=a["south"],
        east=a["east"],
        north=a["north"],
        elev=_f32(a["elevation_f32_b64"]),
        slope=_f32(a["slope_deg_f32_b64"]),
        tri=_f32(a["roughness_m_f32_b64"]),
        tclass=base64.b64decode(a["terrain_class_u8_b64"]),
        hclass=base64.b64decode(h["class_u8_b64"]),
        risk=base64.b64decode(h["risk_u8_b64"]),
        unc=base64.b64decode(h["uncertainty_u8_b64"]),
        provenance_ids=tuple(h["provenance_ids"]),
        tri_scale=ta.relief_scale(a["cell_m"][1]),
    )


def terrain_grid(west: float, south: float, east: float, north: float, step: int = 3) -> Grid:
    """Elevation, Stage 7 terrain products and the Stage 8 hazard and uncertainty maps of one window (CTX, else MOLA)."""
    a = ta.analyze_window(west, south, east, north, step)  # raises 503 / 422 before anything is cached
    return _cached_grid(west, south, east, north, step, a["dem_mtime_ns"])


def _terms(grid: Grid, i: int) -> tuple[float, float, float, float]:
    return (
        min(1.0, grid.slope[i] / SLOPE_REF_DEG),
        min(1.0, grid.tri[i] / (TRI_REF_M * grid.tri_scale)),
        grid.risk[i] / 255,
        grid.unc[i] / 255,
    )


def _science_value(grid: Grid, targets: list[dict[str, Any]], radius_m: float) -> list[float]:
    """V per cell. Only LOW-hazard cells get it: science never makes hazardous ground attractive."""
    value = [0.0] * (grid.rows * grid.cols)
    kr, kc = int(radius_m / grid.dy_m) + 1, int(radius_m / grid.dx_m) + 1
    for t in targets:
        r0, c0 = int(t["y"] // grid.dy_m), int(t["x"] // grid.dx_m)
        for r in range(max(0, r0 - kr), min(grid.rows, r0 + kr + 1)):
            for c in range(max(0, c0 - kc), min(grid.cols, c0 + kc + 1)):
                i = r * grid.cols + c
                v = 1.0 - math.hypot((c + 0.5) * grid.dx_m - t["x"], (r + 0.5) * grid.dy_m - t["y"]) / radius_m
                if v > value[i] and grid.hclass[i] == LOW:
                    value[i] = v
    return value


def _cell_costs(
    grid: Grid, w: dict[str, float], max_slope_deg: float | None, forbid_high: bool, value: list[float]
) -> tuple[bytearray, list[float]]:
    """Per cell: why it is excluded (0 = allowed) and its penalty per metre on top of w_distance."""
    n = grid.rows * grid.cols
    blocked, pen = bytearray(n), [0.0] * n
    cap = MAX_SCIENCE_DISCOUNT * w["distance"]
    for i in range(n):
        s = grid.slope[i]
        if grid.hclass[i] == UNKNOWN or not (math.isfinite(grid.elev[i]) and math.isfinite(s) and math.isfinite(grid.tri[i])):
            blocked[i] = 1
        elif max_slope_deg is not None and s > max_slope_deg:
            blocked[i] = 2
        elif forbid_high and grid.hclass[i] == HIGH:
            blocked[i] = 3
        else:
            pen[i] = sum(w[k] * t for k, t in zip(TERMS, _terms(grid, i))) - min(w["science"] * value[i], cap)
    return blocked, pen


def _search(
    grid: Grid, start: int, goal: int, blocked: bytearray, pen: list[float], w_d: float, h_scale: float
) -> tuple[list[int] | None, float, int]:
    """A* (h_scale > 0) or Dijkstra (h_scale = 0). Returns the cells, the cost and the nodes expanded."""
    rows, cols, dx, dy, elev = grid.rows, grid.cols, grid.dx_m, grid.dy_m, grid.elev
    gr, gc = divmod(goal, cols)
    g = [math.inf] * (rows * cols)
    came: dict[int, int] = {}
    closed = bytearray(rows * cols)
    g[start] = 0.0
    heap = [(0.0, start)]
    expanded = 0
    while heap:
        _, cur = heapq.heappop(heap)
        if closed[cur]:
            continue
        closed[cur] = 1
        expanded += 1
        if cur == goal:
            break
        r, c = divmod(cur, cols)
        for dr, dc in MOVES:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < rows and 0 <= cc < cols):
                continue
            nb = rr * cols + cc
            if closed[nb] or blocked[nb]:
                continue
            if dr and dc and (blocked[cur + dc] or blocked[cur + dr * cols]):
                continue  # a diagonal step may not cut the corner of an excluded cell
            dz = elev[nb] - elev[cur]
            cand = g[cur] + math.sqrt((dc * dx) ** 2 + (dr * dy) ** 2 + dz * dz) * (w_d + 0.5 * (pen[cur] + pen[nb]))
            if cand < g[nb]:
                g[nb] = cand
                came[nb] = cur
                heapq.heappush(heap, (cand + h_scale * math.hypot((rr - gr) * dy, (cc - gc) * dx), nb))
    if not closed[goal]:
        return None, math.inf, expanded
    path = [goal]
    while path[-1] != start:
        path.append(came[path[-1]])
    return path[::-1], g[goal], expanded


def _describe(
    grid: Grid, path: list[int], w: dict[str, float], value: list[float], targets: list[dict[str, Any]], radius_m: float
) -> dict[str, Any]:
    """Objective metrics of a route, all measured on the raster the search ran on."""
    cols, n = grid.cols, len(path)
    terms = [_terms(grid, i) for i in path]
    cap = MAX_SCIENCE_DISCOUNT * w["distance"]
    disc = [min(w["science"] * value[i], cap) for i in path]
    parts = dict.fromkeys(("distance", *TERMS, "science_discount"), 0.0)
    dist = asc = desc = 0.0
    profile = []
    for k, i in enumerate(path):
        if k:
            a = path[k - 1]
            dz = grid.elev[i] - grid.elev[a]
            d = math.sqrt(((i % cols - a % cols) * grid.dx_m) ** 2 + ((i // cols - a // cols) * grid.dy_m) ** 2 + dz * dz)
            dist += d
            asc += max(dz, 0.0)
            desc += max(-dz, 0.0)
            parts["distance"] += d * w["distance"]
            for name, ta_, tb in zip(TERMS, terms[k - 1], terms[k]):
                parts[name] += d * w[name] * 0.5 * (ta_ + tb)
            parts["science_discount"] += d * 0.5 * (disc[k - 1] + disc[k])
        profile.append({"distance_m": round(dist, 1), "elevation_m": round(grid.elev[i], 2), "slope_deg": round(grid.slope[i], 2)})

    xy = [((i % cols + 0.5) * grid.dx_m, (i // cols + 0.5) * grid.dy_m) for i in path]
    x0, x1 = min(x for x, _ in xy) - radius_m, max(x for x, _ in xy) + radius_m
    y0, y1 = min(y for _, y in xy) - radius_m, max(y for _, y in xy) + radius_m
    near = []
    for t in targets:
        if x0 <= t["x"] <= x1 and y0 <= t["y"] <= y1:
            d = min(math.hypot(x - t["x"], y - t["y"]) for x, y in xy)
            if d <= radius_m:
                near.append({**{k: t[k] for k in ("id", "name", "lat", "lon", "rover_sol")}, "distance_to_route_m": round(d, 1)})
    near.sort(key=lambda t: t["distance_to_route_m"])

    def share(codes: bytes, names: tuple[str, ...]) -> dict[str, float]:
        return {name: round(sum(codes[i] == j + 1 for i in path) / n, 3) for j, name in enumerate(names)}

    slopes, tris = [grid.slope[i] for i in path], [grid.tri[i] for i in path]
    risks, uncs = [t[2] for t in terms], [t[3] for t in terms]
    return {
        "geometry": {"type": "LineString", "coordinates": [[round(v, 7) for v in grid.lon_lat(i)] for i in path]},
        "total_distance_m": round(dist, 1),
        "ascent_m": round(asc, 1),
        "descent_m": round(desc, 1),
        "max_slope_deg": round(max(slopes), 2),
        "mean_slope_deg": round(sum(slopes) / n, 2),
        "terrain": {
            "class_share": share(grid.tclass, TERRAIN_CLASSES),
            "roughness_mean_m": round(sum(tris) / n, 2),
            "roughness_max_m": round(max(tris), 2),
        },
        "hazard": {
            "class_share": share(grid.hclass, HAZARD_CLASSES),
            "mean_risk": round(sum(risks) / n, 3),
            "max_risk": round(max(risks), 3),
            "high_cells": sum(grid.hclass[i] == HIGH for i in path),
        },
        "data_quality": {"mean_uncertainty": round(sum(uncs) / n, 3), "max_uncertainty": round(max(uncs), 3)},
        "science_targets": near,
        "elevation_profile": profile,
        "cost": {
            "total": round(sum(parts.values()) - 2 * parts["science_discount"], 2),
            **{k: round(v, 2) for k, v in parts.items()},
        },
    }


def _explain(alt: dict[str, Any], base: dict[str, Any], radius_m: float) -> str:
    hz = alt["hazard"]
    if alt["mode"] == "SHORTEST":
        return (
            f"Minimum ground distance, {alt['total_distance_m'] / 1000:.2f} km. Terrain is not weighed, only excluded cells are "
            f"avoided, so it crosses slopes up to {alt['max_slope_deg']:.1f} deg and {hz['high_cells']} HIGH-hazard cells."
        )
    head = {
        "LOWEST_TERRAIN_RISK": "Lowest sum of distance weighted by slope, roughness, hazard score and data uncertainty, "
        "with HIGH-hazard cells forbidden.",
        "SCIENCE_PRIORITY": f"Terrain-aware cost with a discount within {radius_m:g} m of Perseverance waypoints on LOW-hazard ground.",
    }[alt["mode"]]
    if alt["same_route_as"]:
        return f"{head} It is the same line as {alt['same_route_as']}: under these weights no other line is cheaper."
    extra = alt["total_distance_m"] - base["total_distance_m"]
    return (
        f"{head} Against the shortest route it is {extra:.0f} m longer ({extra / base['total_distance_m']:.0%}): "
        f"max slope {alt['max_slope_deg']:.1f} vs {base['max_slope_deg']:.1f} deg, mean hazard risk {hz['mean_risk']:.2f} vs "
        f"{base['hazard']['mean_risk']:.2f}, HIGH-hazard cells {hz['high_cells']} vs {base['hazard']['high_cells']}, "
        f"science targets within {radius_m:g} m {len(alt['science_targets'])} vs {len(base['science_targets'])}."
    )


def plan(
    grid: Grid,
    start: int,
    goal: int,
    modes: tuple[str, ...] | list[str] = MODES,
    *,
    waypoints: list[int] | tuple[int, ...] = (),
    weights: dict[str, dict[str, float]] | None = None,
    max_slope_deg: float | None = None,
    science_radius_m: float = 200.0,
    targets: list[dict[str, Any]] | tuple[()] = (),
    algorithm: str = "astar",
) -> list[dict[str, Any]]:
    """One alternative per requested mode between two cells (optionally visiting ordered waypoints).

    SHORTEST is always solved, with its preset weights: it is the baseline the others are compared with.
    `weights` overrides preset weights of the other modes; `targets` need id, name, lat, lon, rover_sol.
    """
    pts = [{**t, "x": x, "y": y} for t in targets for x, y in [grid.xy_m(t["lat"], t["lon"])]]
    value = _science_value(grid, pts, science_radius_m)
    stops = [start, *waypoints, goal]
    found: dict[str, dict[str, Any]] = {}
    paths: dict[tuple[int, ...], str] = {}
    out = []
    for mode in dict.fromkeys(("SHORTEST", *modes)):
        w = PRESETS[mode] if mode == "SHORTEST" else {**PRESETS[mode], **(weights or {}).get(mode, {})}
        forbid_high = mode == "LOWEST_TERRAIN_RISK"
        blocked, pen = _cell_costs(grid, w, max_slope_deg, forbid_high, value)
        constraints = [
            "Cells without elevation, slope or roughness (NoData and their neighbours) are never crossed.",
            "A diagonal step may not cut the corner of an excluded cell.",
        ]
        if max_slope_deg is not None:
            constraints.append(f"Cells steeper than {max_slope_deg:g} deg are excluded (a user preference, not a validated safety threshold).")
        if forbid_high:
            constraints.append("HIGH hazard-class cells (Stage 8) are forbidden zones.")
        if w["science"] > 0:
            constraints.append(f"The science discount applies only on LOW-hazard cells and waives at most {MAX_SCIENCE_DISCOUNT:.0%} of the distance term.")
        if waypoints:
            constraints.append(f"Visits {len(waypoints)} selected scientific waypoint(s) in order.")
        alt: dict[str, Any] = {"mode": mode, "algorithm": algorithm, "weights": w, "constraints": constraints}

        labels = ["start", *(f"waypoint #{k + 1}" for k in range(len(waypoints))), "destination"]
        excluded = [(name, cell) for name, cell in zip(labels, stops) if blocked[cell]]
        path, expanded = None, 0
        if not excluded:
            # Admissible and consistent: no step costs less per planar metre than the cheapest multiplier.
            h_scale = w["distance"] - min(w["science"] * max(value), MAX_SCIENCE_DISCOUNT * w["distance"])
            full_path: list[int] = []
            ok = True
            for a_cell, b_cell in zip(stops, stops[1:]):
                seg, _, seg_exp = _search(
                    grid, a_cell, b_cell, blocked, pen, w["distance"], h_scale if algorithm == "astar" else 0.0
                )
                expanded += seg_exp
                if seg is None:
                    ok = False
                    break
                full_path.extend(seg if not full_path else seg[1:])
            if ok and full_path:
                path = full_path
        alt["nodes_expanded"] = expanded
        if path is None:
            alt["status"] = "unreachable"
            alt["reason"] = (
                " ".join(f"The {name} cell is excluded: {BLOCK_REASON[blocked[cell]]}." for name, cell in excluded)
                or "Start and destination are separated by cells this mode may not cross: "
                + "; ".join(BLOCK_REASON[k] for k in sorted(set(blocked) - {0}))
                + "."
            )
        else:
            alt.update(status="found", same_route_as=paths.get(tuple(path)), **_describe(grid, path, w, value, pts, science_radius_m))
            paths.setdefault(tuple(path), mode)
            found[mode] = alt
            base = found["SHORTEST"]
            alt["extra_distance_vs_shortest_m"] = round(alt["total_distance_m"] - base["total_distance_m"], 1)
            alt["explanation"] = _explain(alt, base, science_radius_m)
        if mode in modes:
            out.append(alt)
    return out
