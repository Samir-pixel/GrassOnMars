#!/usr/bin/env python3
"""
Настоящая карта и рельеф Езеро для режима Marswalk.

Берёт готовые веб-тайлы (WebMercatorQuad, XYZ) из открытого проекта Jez Explore
(github.com/astrodavid10/jez-explore). Внутри — снимки HiRISE и CTX
(NASA/JPL-Caltech/UArizona, NASA/JPL-Caltech/MSSS) и модели рельефа HiRISE/HRSC
(USGS Astrogeology), высоты закодированы в PNG по схеме Terrarium.

Результат:
  data/jezero_ctx.jpg     обзорная карта всего района (≈5 м/пиксель)
  data/jezero_hirise.jpg  детальная карта коридора прогулки (≈1,2 м/пиксель)
  data/jezero_imagery.json границы снимков в градусах
  data/terrain.json       настоящая сетка высот для маршрутизатора

Запуск: python tools/fetch_jezero.py
"""
import io
import json
import math
import base64
import concurrent.futures as cf
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://raw.githubusercontent.com/astrodavid10/jez-explore/{sha}/tiles/{layer}/{z}/{x}/{y}.{ext}"
SHA = "f0a5a2572ddfd5c8abc88e3b9972c4c6be1981d1"
ELEV_OFFSET = 4000  # из tiles/manifest.json проекта
MARS_R = 3396190.0
M_PER_DEG = math.pi / 180 * MARS_R

# Район рельефа (как у прежней демо-сетки) и коридор прогулки
AREA = dict(west=77.30, south=18.30, east=77.60, north=18.55)
CORRIDOR = dict(west=77.345, south=18.415, east=77.47, north=18.495)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def lat_of_y(y, z):
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


def fetch(layer, z, x, y, ext):
    url = REPO.format(sha=SHA, layer=layer, z=z, x=x, y=y, ext=ext)
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:  # noqa: BLE001 — нет тайла или сбой сети
            continue
    return None


def mosaic(layer, z, box, ext, fill=(0, 0, 0)):
    """Склеивает тайлы и перепроецирует в равнопромежуточную сетку (как в Leaflet EPSG:4326)."""
    x0, y0 = tile_xy(box["west"], box["north"], z)
    x1, y1 = tile_xy(box["east"], box["south"], z)
    tx = range(int(x0), int(x1) + 1)
    ty = range(int(y0), int(y1) + 1)
    W, H = len(tx) * 256, len(ty) * 256
    canvas = Image.new("RGB", (W, H), fill)
    jobs = [(i, j, x, y) for i, x in enumerate(tx) for j, y in enumerate(ty)]
    missing = 0
    with cf.ThreadPoolExecutor(16) as ex:
        for (i, j, x, y), img in zip(jobs, ex.map(lambda a: fetch(layer, z, a[2], a[3], ext), jobs)):
            if img is None:
                missing += 1
            else:
                canvas.paste(img, (i * 256, j * 256))
    print(f"  {layer} z{z}: {len(jobs)} тайлов, нет {missing}")
    arr = np.asarray(canvas)
    # Пиксели, попадающие в box, и перепроекция строк по широте
    px0 = (x0 - tx[0]) * 256
    px1 = (x1 - tx[0]) * 256
    out_w = int(round(px1 - px0))
    # высота по широте с тем же масштабом по долготе (с учётом cos φ для равного вида)
    deg_per_px = (box["east"] - box["west"]) / out_w
    out_h = int(round((box["north"] - box["south"]) / deg_per_px))
    lats = box["north"] - (np.arange(out_h) + 0.5) * deg_per_px
    ys = np.array([(tile_xy(box["west"], la, z)[1] - ty[0]) * 256 for la in lats])
    xs = px0 + (np.arange(out_w) + 0.5) * (px1 - px0) / out_w
    yi = np.clip(ys.astype(int), 0, H - 1)
    xi = np.clip(xs.astype(int), 0, W - 1)
    return arr[yi][:, xi]


def save_jpeg(arr, path, quality, max_w=None):
    img = Image.fromarray(arr)
    if max_w and img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    print(f"  {path.name}: {img.width}×{img.height}, {path.stat().st_size // 1024} КБ")
    return img.size


def build_terrain(z=13, cols=330, rows=270):
    arr = mosaic("dem", z, AREA, "png").astype(np.float64)
    h = arr[..., 0] * 256 + arr[..., 1] + arr[..., 2] / 256 - 32768 - ELEV_OFFSET
    h[(arr.sum(axis=2) == 0)] = np.nan
    # Усреднение блоками до сетки маршрутизатора
    H, W = h.shape
    yi = (np.arange(rows + 1) * H / rows).astype(int)
    xi = (np.arange(cols + 1) * W / cols).astype(int)
    grid = np.empty((rows, cols))
    for r in range(rows):
        band = h[yi[r]:yi[r + 1]]
        for c in range(cols):
            grid[r, c] = np.nanmean(band[:, xi[c]:xi[c + 1]])
    if np.isnan(grid).any():
        grid = np.where(np.isnan(grid), np.nanmean(grid), grid)
    mid = math.radians((AREA["south"] + AREA["north"]) / 2)
    cx = (AREA["east"] - AREA["west"]) / cols * M_PER_DEG * math.cos(mid)
    cy = (AREA["north"] - AREA["south"]) / rows * M_PER_DEG
    dm = np.round(grid * 10).astype("<i2")
    out = {
        "meta": {
            "source": "HiRISE and HRSC elevation blend (USGS Astrogeology, NASA/JPL/UArizona, ESA/DLR/FU Berlin) via Jez Explore tiles",
            "demo": False,
            "zoom": z,
        },
        "bounds": AREA,
        "rows": rows,
        "cols": cols,
        "cell_m": [round(cx, 2), round(cy, 2)],
        "elev_dm_b64": base64.b64encode(dm.tobytes()).decode(),
    }
    (ROOT / "data/terrain.json").write_text(json.dumps(out, separators=(",", ":")))
    return out
    print(f"  terrain.json: {rows}×{cols}, ячейка {cx:.0f}×{cy:.0f} м, высоты {np.nanmin(grid):.0f}…{np.nanmax(grid):.0f} м")


def main():
    print("Обзорная карта (CTX/HiRISE)…")
    a = mosaic("img", 14, AREA, "webp", fill=(40, 30, 26))
    save_jpeg(a, ROOT / "data/jezero_ctx.jpg", 80, max_w=3600)
    print("Детальная карта коридора (HiRISE)…")
    b = mosaic("imghi", 16, CORRIDOR, "webp", fill=(40, 30, 26))
    save_jpeg(b, ROOT / "data/jezero_hirise.jpg", 74, max_w=6000)
    (ROOT / "data/jezero_imagery.json").write_text(json.dumps({
        "outer": {"url": "data/jezero_ctx.jpg", "bounds": AREA},
        "inner": {"url": "data/jezero_hirise.jpg", "bounds": CORRIDOR},
        "credit": "HiRISE: NASA/JPL-Caltech/UArizona · CTX: NASA/JPL-Caltech/MSSS · tiles: Jez Explore (A. D. Weigel)",
    }, indent=2))
    print("Рельеф…")
    terrain = build_terrain()
    write_js(terrain)


def write_js(terrain):
    """js/jezero_data.js — те же данные для страницы (и для сборки в один файл)."""
    imagery = json.loads((ROOT / "data/jezero_imagery.json").read_text())
    js = ("// Сгенерировано tools/fetch_jezero.py — настоящая карта и рельеф Езеро\n"
          f"window.JEZERO_IMAGERY = {json.dumps(imagery)};\n"
          f"window.JEZERO_TERRAIN = {json.dumps(terrain, separators=(',', ':'))};\n")
    (ROOT / "js/jezero_data.js").write_text(js)
    print(f"  js/jezero_data.js: {len(js) // 1024} КБ")


if __name__ == "__main__":
    main()
