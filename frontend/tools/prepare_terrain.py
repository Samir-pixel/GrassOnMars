#!/usr/bin/env python3
"""
Готовит сетку рельефа и склонов для Marswalk Planner.

Примеры:
  # Синтетический рельеф для проверки, без внешних данных:
  python prepare_terrain.py --demo

  # Настоящая модель рельефа (HiRISE DTM, CTX DTM или файл из Mars Trek):
  python prepare_terrain.py --dtm data/raw/jezero_dtm.tif --max-size 300

Результат: data/terrain.json, который читает веб-страница.
"""
import argparse
import json
import math
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

MARS_RADIUS_M = 3396190.0  # радиус сферы Mars 2000, в нём заданы HiRISE DTM
M_PER_DEG = math.pi / 180 * MARS_RADIUS_M


# ---------- Загрузка настоящей модели рельефа ----------

def load_dtm(path, bbox_override=None):
    """Читает DTM через rasterio. Возвращает высоты, размер ячейки в метрах и границы в градусах."""
    import rasterio  # импорт здесь, чтобы --demo работал без rasterio

    with rasterio.open(path) as src:
        elev = src.read(1, masked=True).astype("float64").filled(np.nan)
        transform, crs, b = src.transform, src.crs, src.bounds

    # Некоторые DTM используют огромные отрицательные числа как «нет данных»
    elev[elev < -1e5] = np.nan

    if bbox_override:
        west, south, east, north = bbox_override
    elif crs is None:
        raise SystemExit("У файла нет системы координат. Укажите границы вручную: --bbox W S E N")
    elif crs.is_geographic:
        west, south, east, north = b.left, b.bottom, b.right, b.top
    else:
        from pyproj import CRS, Transformer
        proj = CRS.from_wkt(crs.to_wkt())
        tr = Transformer.from_crs(proj, proj.geodetic_crs, always_xy=True)
        xs = [b.left, b.right, b.left, b.right]
        ys = [b.bottom, b.bottom, b.top, b.top]
        lons, lats = tr.transform(xs, ys)
        west, east = min(lons), max(lons)
        south, north = min(lats), max(lats)

    # Размер ячейки в метрах
    if crs is not None and crs.is_geographic:
        mid_lat = math.radians((south + north) / 2)
        cell_x = abs(transform.a) * M_PER_DEG * math.cos(mid_lat)
        cell_y = abs(transform.e) * M_PER_DEG
    else:
        cell_x, cell_y = abs(transform.a), abs(transform.e)

    return elev, cell_x, cell_y, (west, south, east, north)


# ---------- Синтетический рельеф для демо ----------

def make_demo_terrain():
    """
    Условный рельеф западной части кратера Езеро: дно кратера, крутой фронт дельты
    с промоиной, дюны у Séítah, несколько крупных кратеров и подъём к западному валу.
    Это НЕ реальные данные, только для отладки и демо.
    """
    west, south, east, north = 77.30, 18.30, 77.60, 18.55
    rows, cols = 240, 270
    rng = np.random.default_rng(7)

    lat = np.linspace(north, south, rows)[:, None]
    lon = np.linspace(west, east, cols)[None, :]
    LAT = np.broadcast_to(lat, (rows, cols))
    LON = np.broadcast_to(lon, (rows, cols))

    # Дно кратера, к западу поднимается, у самого края — крутой вал
    elev = -2560.0 + (77.60 - LON) * 500
    elev += 260 / (1 + np.exp((LON - 77.318) / 0.006))

    # Дельта: плато +110 м с крутым фронтом
    d = np.hypot(LON - 77.36, (LAT - 18.475) * 1.25)
    delta = 110 / (1 + np.exp((d - 0.06) / 0.0016))
    # Промоина — древнее русло, прорезающее фронт дельты (пологий проход)
    chan = np.exp(-((LAT - 18.462 - (LON - 77.40) * 0.35) / 0.006) ** 2) * (LON > 77.37)
    ramp = 110 * np.clip((0.075 - d) / 0.035, 0, 1)  # плавный подъём по руслу, ~3–4°
    elev += delta * (1 - chan) + ramp * chan

    # Дюны у Séítah: гряды с шагом ~300 м
    seitah = np.exp(-(((LON - 77.428) / 0.016) ** 2 + ((LAT - 18.427) / 0.012) ** 2))
    elev += seitah * 9 * np.sin((LON * 0.8 + LAT * 0.6) * 2 * np.pi / 0.0045)

    # Крупные кратеры (центр lat, lon, радиус в градусах, глубина м)
    big = [(18.447, 77.428, 0.010, 70), (18.40, 77.47, 0.018, 110), (18.49, 77.45, 0.014, 90),
           (18.36, 77.38, 0.016, 100), (18.52, 77.40, 0.009, 60)]
    for cy, cx, rad, depth in big:
        r = np.hypot(LON - cx, LAT - cy) / rad
        bowl = -depth * np.clip(1 - r ** 2, 0, None) ** 0.7
        rim = 0.3 * depth * np.exp(-((r - 1.05) / 0.12) ** 2)
        elev += bowl + rim
    # Мелкие кратеры
    for _ in range(35):
        cy, cx = rng.uniform(south, north), rng.uniform(west, east)
        rad = rng.uniform(0.002, 0.006)
        r = np.hypot(LON - cx, LAT - cy) / rad
        elev += np.where(r < 1, -25 * rad / 0.005 * (1 - r ** 2), 0)
        elev += 6 * rad / 0.005 * np.exp(-((r - 1.05) / 0.15) ** 2)
    # Мягкий шум
    noise = rng.normal(0, 1, (rows // 6 + 1, cols // 6 + 1))
    noise = np.kron(noise, np.ones((6, 6)))[:rows, :cols]
    for _ in range(3):
        noise = sum(np.roll(np.roll(noise, i, 0), j, 1) for i in range(-3, 4) for j in range(-3, 4)) / 49
    elev = elev + noise * 15

    mid_lat = math.radians((south + north) / 2)
    cell_x = (east - west) / cols * M_PER_DEG * math.cos(mid_lat)
    cell_y = (north - south) / rows * M_PER_DEG
    return np.array(elev), cell_x, cell_y, (west, south, east, north)


# ---------- Обработка ----------

def downsample(elev, max_size):
    """Усредняет блоки, чтобы сетка была не больше max_size по стороне."""
    f = max(1, math.ceil(max(elev.shape) / max_size))
    if f == 1:
        return elev, 1
    rows, cols = (elev.shape[0] // f) * f, (elev.shape[1] // f) * f
    blocks = elev[:rows, :cols].reshape(rows // f, f, cols // f, f)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # блоки целиком без данных
        return np.nanmean(blocks, axis=(1, 3)), f


def slope_degrees(elev, cell_x, cell_y):
    dz_dy, dz_dx = np.gradient(elev, cell_y, cell_x)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--dtm", help="Путь к модели рельефа (GeoTIFF или PDS .IMG)")
    src.add_argument("--demo", action="store_true", help="Сгенерировать синтетический рельеф")
    p.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"),
                   help="Границы в градусах, если их не удаётся определить из файла")
    p.add_argument("--max-size", type=int, default=300, help="Максимум ячеек по стороне (по умолчанию 300)")
    p.add_argument("--out", default="data/terrain.json")
    p.add_argument("--name", default=None, help="Подпись источника на карте")
    args = p.parse_args()

    if args.demo:
        elev, cx, cy, bbox = make_demo_terrain()
        source = args.name or "Synthetic demo terrain (not real data)"
    else:
        elev, cx, cy, bbox = load_dtm(args.dtm, args.bbox)
        source = args.name or Path(args.dtm).name

    elev, f = downsample(elev, args.max_size)
    cx, cy = cx * f, cy * f
    slope = slope_degrees(elev, cx, cy)

    rows, cols = elev.shape
    nodata = np.isnan(elev) | np.isnan(slope)
    elev_out = np.where(nodata, np.nan, np.round(elev, 1))
    slope_out = np.where(nodata, -1, np.round(slope, 1))

    west, south, east, north = bbox
    out = {
        "meta": {
            "source": source,
            "demo": bool(args.demo),
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "downsample_factor": f,
        },
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "rows": rows,
        "cols": cols,
        "cell_m": [round(cx, 2), round(cy, 2)],
        # null там, где нет данных; ряд 0 — северный край
        "elev": [None if math.isnan(v) else v for v in elev_out.ravel().tolist()],
        "slope": slope_out.ravel().tolist(),
    }

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    valid = slope[~nodata]
    print(f"Сохранено: {args.out}")
    print(f"  Сетка {rows}×{cols}, ячейка {cx:.0f}×{cy:.0f} м, уменьшение ×{f}")
    print(f"  Границы: W {west:.4f}, S {south:.4f}, E {east:.4f}, N {north:.4f}")
    print(f"  Высоты: {np.nanmin(elev):.0f}…{np.nanmax(elev):.0f} м")
    print(f"  Склоны: медиана {np.median(valid):.1f}°, 95-й перцентиль {np.percentile(valid, 95):.1f}°")


if __name__ == "__main__":
    main()
