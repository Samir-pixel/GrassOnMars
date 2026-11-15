"""Planetary DEM terrain analysis (Stage 7): slope, hillshade, roughness (TRI), classification,
GeoTIFF export, point slope, and elevation profiles.

Uses pure Python + stdlib over `geotiff.py` (no GDAL/NumPy binary dependencies) while validating
Mars sphere CRS, metre pixel scale, latitude cosine ground spacing, and NoData preservation.
"""

from __future__ import annotations

import base64
import math
import sys
from array import array
from functools import lru_cache
from typing import Any

from app.core.errors import AppError
from app.integrations import ctx_dtm, geotiff, mola

MARS_RADIUS_M = 3_396_190.0
NAN = float("nan")
REF_SPACING_M = 60.0  # the analysis grid the TRI and relief thresholds were set on (CTX 20 m, step 3)


def relief_scale(spacing_m: float) -> float:
    """Height differences between neighbouring cells grow with their spacing, so thresholds in metres grow with it above 60 m."""
    return max(1.0, spacing_m / REF_SPACING_M)


def validate_dem(tiff: geotiff.GeoTiff, resolution_m: float, center_lat_deg: float, step: int = 1) -> dict[str, Any]:
    """Validate Mars DEM metadata/CRS and compute true latitude-corrected ground spacing [dx_m, dy_m]."""
    if tiff.pixel_scale <= 0 or not math.isfinite(tiff.pixel_scale):
        raise AppError(422, "INVALID_DEM_METADATA", "Масштаб пикселя DEM некорректен.")
    if tiff.semi_major_m is None or abs(tiff.semi_major_m - MARS_RADIUS_M) > 100.0:
        raise AppError(422, "INVALID_DEM_CRS", "DEM не соответствует сферической СК Марса (R = 3 396 190 м).")
    cos_lat = math.cos(math.radians(center_lat_deg))
    if cos_lat <= 1e-4:
        raise AppError(422, "INVALID_DEM_LATITUDE", "Широта слишком близка к полюсу для прямоугольной сетки.")
    dy_m = step * tiff.pixel_scale
    dx_m = dy_m * cos_lat
    return {
        "crs_wkt": tiff.citation,
        "working_srid": 949900,
        "sphere_radius_m": tiff.semi_major_m,
        "horizontal_units": "metres (projected Equirectangular; dx scaled by cos(lat))",
        "vertical_units": "metres above MOLA areoid",
        "native_resolution_m": resolution_m,
        "effective_spacing_m": [round(dx_m, 3), round(dy_m, 3)],
        "resampling": "none (native cells)" if step == 1 else f"step-{step} subsampling (no interpolation)",
        "coarse_for_eva": resolution_m >= 100.0,
    }


def compute_products(
    elev: array | list[float],
    rows: int,
    cols: int,
    dx_m: float,
    dy_m: float,
    *,
    azimuth_deg: float = 315.0,
    altitude_deg: float = 40.0,
) -> dict[str, Any]:
    """Compute slope (deg), hillshade (1..255, 0=NoData), roughness TRI (m), and terrain class (1..4, 0=NoData)."""
    if rows < 2 or cols < 2 or len(elev) != rows * cols:
        raise ValueError("grid must be at least 2x2 and match rows*cols")
    if dx_m <= 0 or dy_m <= 0:
        raise ValueError("ground spacing dx_m and dy_m must be positive")

    n = rows * cols
    slope = array("f", [NAN]) * n
    roughness = array("f", [NAN]) * n
    hillshade = bytearray(n)
    tclass = bytearray(n)

    k = relief_scale(dy_m)
    az = math.radians(azimuth_deg)
    alt = math.radians(altitude_deg)
    sin_alt, cos_alt = math.sin(alt), math.cos(alt)
    inv2x, inv1x = 1.0 / (2.0 * dx_m), 1.0 / dx_m
    inv2y, inv1y = 1.0 / (2.0 * dy_m), 1.0 / dy_m

    finite = [math.isfinite(v) for v in elev]

    for r in range(rows):
        row_off = r * cols
        for c in range(cols):
            i = row_off + c
            if not finite[i]:
                continue
            zc = elev[i]

            if 0 < c < cols - 1:
                if not (finite[i - 1] and finite[i + 1]):
                    continue
                gx = (elev[i + 1] - elev[i - 1]) * inv2x
            elif c == 0:
                if not finite[i + 1]:
                    continue
                gx = (elev[i + 1] - zc) * inv1x
            else:
                if not finite[i - 1]:
                    continue
                gx = (zc - elev[i - 1]) * inv1x

            if 0 < r < rows - 1:
                if not (finite[i - cols] and finite[i + cols]):
                    continue
                gy = (elev[i + cols] - elev[i - cols]) * inv2y
            elif r == 0:
                if not finite[i + cols]:
                    continue
                gy = (elev[i + cols] - zc) * inv1y
            else:
                if not finite[i - cols]:
                    continue
                gy = (zc - elev[i - cols]) * inv1y

            grad = math.hypot(gx, gy)
            sl_rad = math.atan(grad)
            sl_deg = math.degrees(sl_rad)
            slope[i] = sl_deg

            # Note: gy points South (+row), so North-facing slope has gy > 0; aspect matches Horn/ESRI clockwise from N.
            aspect = math.atan2(gy, -gx)
            shade = sin_alt * math.cos(sl_rad) + cos_alt * math.sin(sl_rad) * math.cos(az - aspect)
            hillshade[i] = max(1, min(255, round(shade * 254.0) + 1))

            # TRI roughness across available 3x3 neighbors; any NoData neighbor invalidates the 3x3 cell.
            sq_sum = 0.0
            cnt = 0
            nodata_nb = False
            for dr in (-1, 0, 1):
                rr = r + dr
                if not (0 <= rr < rows):
                    continue
                nb_off = rr * cols
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    cc = c + dc
                    if not (0 <= cc < cols):
                        continue
                    j = nb_off + cc
                    if not finite[j]:
                        nodata_nb = True
                        break
                    d = elev[j] - zc
                    sq_sum += d * d
                    cnt += 1
                if nodata_nb:
                    break
            if nodata_nb or cnt == 0:
                slope[i] = NAN
                hillshade[i] = 0
                continue
            tri = math.sqrt(sq_sum / cnt)
            roughness[i] = tri

            if sl_deg >= 15.0:
                tclass[i] = 4
            elif sl_deg >= 10.0 or tri >= 5.0 * k:
                tclass[i] = 3
            elif sl_deg >= 5.0 or tri >= 2.0 * k:
                tclass[i] = 2
            else:
                tclass[i] = 1

    valid_elev = [elev[i] for i in range(n) if finite[i]]
    valid_slope = sorted(slope[i] for i in range(n) if math.isfinite(slope[i]))
    valid_tri = sorted(roughness[i] for i in range(n) if math.isfinite(roughness[i]))
    counts = {str(k): 0 for k in range(5)}
    for v in tclass:
        counts[str(v)] += 1

    report = {
        "total_cells": n,
        "valid_elev_cells": len(valid_elev),
        "nodata_elev_cells": n - len(valid_elev),
        "valid_derived_cells": len(valid_slope),
        "elevation_min_m": round(min(valid_elev), 2) if valid_elev else None,
        "elevation_max_m": round(max(valid_elev), 2) if valid_elev else None,
        "relief_m": round(max(valid_elev) - min(valid_elev), 2) if valid_elev else None,
        "slope_mean_deg": round(sum(valid_slope) / len(valid_slope), 2) if valid_slope else None,
        "slope_p90_deg": round(valid_slope[int(0.9 * (len(valid_slope) - 1))], 2) if valid_slope else None,
        "slope_max_deg": round(valid_slope[-1], 2) if valid_slope else None,
        "roughness_mean_m": round(sum(valid_tri) / len(valid_tri), 2) if valid_tri else None,
        "roughness_p90_m": round(valid_tri[int(0.9 * (len(valid_tri) - 1))], 2) if valid_tri else None,
        "roughness_max_m": round(valid_tri[-1], 2) if valid_tri else None,
        "class_counts": counts,
    }
    return {
        "slope": slope,
        "roughness": roughness,
        "hillshade": bytes(hillshade),
        "terrain_class": bytes(tclass),
        "quality_report": report,
    }


def _b64_f32(arr: array) -> str:
    if sys.byteorder == "big":
        arr = array("f", arr)
        arr.byteswap()
    return base64.b64encode(arr.tobytes()).decode("ascii")


def _dem(west: float, south: float, east: float, north: float) -> tuple[Any, Any]:
    """Finest acquired DEM that covers the whole window: CTX 20 m, else a MOLA 463 m site window."""
    for mod in (ctx_dtm, mola):
        path = mod.covering(west, south, east, north)
        if path is not None:
            return mod, path
    return ctx_dtm, None


@lru_cache(maxsize=6)
def _cached_analysis(mod: Any, west: float, south: float, east: float, north: float, step: int, path: Any, mtime_ns: int) -> dict[str, Any]:
    g = mod.grid(west, south, east, north, step)
    tiff, _ = geotiff.load(path, mod.SOURCE)
    meta = validate_dem(tiff, mod.RESOLUTION_M, (g["north"] + g["south"]) / 2.0, step)
    meta["effective_spacing_m"] = [round(v, 3) for v in g["cell_m"]]
    raw = base64.b64decode(g["elevation_f32_b64"])
    elev = array("f")
    elev.frombytes(raw)
    if sys.byteorder == "big":
        elev.byteswap()
    prod = compute_products(elev, g["rows"], g["cols"], g["cell_m"][0], g["cell_m"][1])
    meta["dem"] = mod.TITLE
    meta["limitations"] = (
        f"Derived from {mod.TITLE} (subsampled step={step}, ground spacing "
        f"{g['cell_m'][0]:.1f}x{g['cell_m'][1]:.1f} m). Hazards smaller than {g['cell_m'][1]:.0f} m are unresolved."
    )
    return {
        "dem_mtime_ns": mtime_ns,  # lets dependants cache on the file this was computed from
        "data_class": "DERIVED",
        "provenance_ids": g["provenance_ids"],
        "resolution_m": g["resolution_m"],
        "vertical_datum": g["vertical_datum"],
        "step": g["step"],
        "west": g["west"],
        "south": g["south"],
        "east": g["east"],
        "north": g["north"],
        "rows": g["rows"],
        "cols": g["cols"],
        "cell_m": g["cell_m"],
        "elevation_f32_b64": g["elevation_f32_b64"],
        "slope_deg_f32_b64": _b64_f32(prod["slope"]),
        "roughness_m_f32_b64": _b64_f32(prod["roughness"]),
        "hillshade_u8_b64": base64.b64encode(prod["hillshade"]).decode("ascii"),
        "terrain_class_u8_b64": base64.b64encode(prod["terrain_class"]).decode("ascii"),
        "metadata": meta,
        "quality_report": prod["quality_report"],
    }


def analyze_window(west: float, south: float, east: float, north: float, step: int = 3) -> dict[str, Any]:
    """Terrain products of a window on the finest DEM that covers it."""
    mod, path = _dem(west, south, east, north)
    if path is None:  # nothing covers the window: the CTX connector reports it (503 not acquired, 422 outside)
        return ctx_dtm.grid(west, south, east, north, step)
    return _cached_analysis(mod, west, south, east, north, step, path, path.stat().st_mtime_ns)


def export_geotiff(layer: str, west: float, south: float, east: float, north: float, step: int = 3) -> bytes:
    """Export elevation, slope, roughness, hillshade, or terrain_class as a standalone Mars GeoTIFF."""
    if layer not in {"elevation", "slope", "roughness", "hillshade", "terrain_class"}:
        raise AppError(422, "UNKNOWN_TERRAIN_LAYER", f"Неизвестный слой рельефа: {layer}.")
    a = analyze_window(west, south, east, north, step)
    mod, path = _dem(west, south, east, north)
    tiff, _ = geotiff.load(path, mod.SOURCE)
    ppd = mod.pixels_per_degree(tiff)
    col, row = geotiff.pixel_at(tiff, west, north, ppd)  # type: ignore[misc]

    # shortcut: writes classic stripped GeoTIFF via geotiff.build_subset_bytes; upgrade to tiled COG if GDAL is added.
    if layer == "hillshade":
        samples = array("B", base64.b64decode(a["hillshade_u8_b64"]))
        nodata_text = "0"
    elif layer == "terrain_class":
        samples = array("B", base64.b64decode(a["terrain_class_u8_b64"]))
        nodata_text = "0"
    else:
        key = {"elevation": "elevation_f32_b64", "slope": "slope_deg_f32_b64", "roughness": "roughness_m_f32_b64"}[layer]
        samples = array("f")
        samples.frombytes(base64.b64decode(a[key]))
        if sys.byteorder == "big":
            samples.byteswap()
        if tiff.nodata is not None:
            nd = tiff.nodata
            samples = array("f", (nd if math.isnan(v) else v for v in samples))
        nodata_text = None
    return geotiff.build_subset_bytes(
        tiff, col, row, a["cols"], samples, pixel_scale=tiff.pixel_scale * step, nodata_text=nodata_text
    )


def point_analysis(lat: float, lon: float) -> dict[str, Any]:
    """Derived slope, TRI roughness, and terrain class at (lat, lon) on the finest available DEM (CTX 20 m -> MOLA 463 m)."""
    ctx_path = ctx_dtm.product_path()
    if ctx_path.exists():
        tiff, samples = geotiff.load(ctx_path, ctx_dtm.SOURCE)
        ppd = ctx_dtm.pixels_per_degree(tiff)
        px = geotiff.pixel_at(tiff, lon, lat, ppd)
        dataset_id, res_m, coarse = ctx_dtm.DATASET_ID, ctx_dtm.RESOLUTION_M, False
    else:
        tiff, samples, ppd, px = None, None, 0.0, None
        dataset_id, res_m, coarse = "", 0.0, True

    if px is None:
        mpath = mola.covering(lon, lat, lon, lat)
        if mpath is None:
            raise AppError(422, "OUTSIDE_COVERAGE", "Точка вне загруженных моделей рельефа.")
        tiff, samples = geotiff.load(mpath, mola.SOURCE)
        ppd = mola.PIXELS_PER_DEGREE
        px = geotiff.pixel_at(tiff, lon, lat, ppd)
        dataset_id, res_m, coarse = mola.DATASET_ID, mola.RESOLUTION_M, True

    col, row = px
    if not (1 <= col < tiff.width - 1 and 1 <= row < tiff.height - 1):
        raise AppError(422, "OUTSIDE_COVERAGE", "Точка на самой границе сетки: недостаточно соседних ячеек для уклона.")
    win = [
        NAN if samples[(row + dr) * tiff.width + col + dc] == tiff.nodata else float(samples[(row + dr) * tiff.width + col + dc])
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
    ]
    dx_m = res_m * math.cos(math.radians(lat))
    prod = compute_products(win, 3, 3, dx_m, res_m)
    sl = prod["slope"][4]
    tri = prod["roughness"][4]
    cls = prod["terrain_class"][4]
    cls_names = {0: "nodata", 1: "smooth", 2: "moderate", 3: "steep", 4: "hazard"}
    return {
        "lat": lat,
        "lon": lon,
        "elevation_m": None if math.isnan(win[4]) else round(win[4], 2),
        "slope_deg": None if math.isnan(sl) else round(sl, 2),
        "roughness_m": None if math.isnan(tri) else round(tri, 2),
        "terrain_class": cls_names[cls],
        "resolution_m": res_m,
        "data_class": "DERIVED",
        "provenance_ids": [dataset_id],
        "coarse_for_eva": coarse,
        "limitations": (
            "Coarse 463 m MOLA DEM: regional context only, unsuitable for EVA slope safety."
            if coarse
            else "20 m CTX DEM: boulders and ledges smaller than ~20 m are unresolved."
        ),
    }


def _mars_dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_m = math.radians((lat1 + lat2) * 0.5)
    return math.hypot(
        math.radians(lon2 - lon1) * MARS_RADIUS_M * math.cos(lat_m),
        math.radians(lat2 - lat1) * MARS_RADIUS_M,
    )


def line_profile(start_lat: float, start_lon: float, end_lat: float, end_lon: float, samples_n: int = 48) -> dict[str, Any]:
    """Derived elevation and slope profile between two coordinates using the 20 m CTX DTM (or MOLA outside CTX)."""
    total_m = _mars_dist_m(start_lat, start_lon, end_lat, end_lon)
    points = []
    provs: set[str] = set()
    res_max = 0.0
    for k in range(samples_n):
        f = k / (samples_n - 1)
        lat = start_lat + (end_lat - start_lat) * f
        lon = start_lon + (end_lon - start_lon) * f
        pt = point_analysis(lat, lon)
        provs.update(pt["provenance_ids"])
        res_max = max(res_max, pt["resolution_m"])
        points.append({
            "distance_m": round(total_m * f, 1),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "elevation_m": pt["elevation_m"],
            "slope_deg": pt["slope_deg"],
        })
    elevs = [p["elevation_m"] for p in points if p["elevation_m"] is not None]
    ascent = sum(max(0.0, b - a) for a, b in zip(elevs, elevs[1:]))
    descent = sum(max(0.0, a - b) for a, b in zip(elevs, elevs[1:]))
    return {
        "data_class": "DERIVED",
        "provenance_ids": sorted(provs),
        "resolution_m": res_max,
        "total_distance_m": round(total_m, 1),
        "ascent_m": round(ascent, 1),
        "descent_m": round(descent, 1),
        "points": points,
    }
