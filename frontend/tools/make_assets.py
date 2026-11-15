#!/usr/bin/env python3
"""
Собирает js/assets.js: глобальная текстура Марса (NASA 3D Resources, на основе Viking),
демо-рельеф Езеро и изображения Nova (data/nova). Нужен, чтобы сайт работал даже без интернета и без data/terrain.json.

  python tools/make_assets.py
"""
import base64, io, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from prepare_terrain import make_demo_terrain  # noqa: E402

def jpeg_b64(path, size=None, quality=82):
    img = Image.open(ROOT / path).convert("RGB")
    if size:
        img = img.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

# Цветная карта 4096×2048 (Celestia, на основе USGS Viking + MGS) и карта нормалей для рельефа
tex = jpeg_b64("data/mars_color_4k_celestia.jpg", quality=80)
normal = jpeg_b64("data/mars_normal_2k_celestia.png", quality=85)

elev, cx, cy, (w, s, e, n) = make_demo_terrain()
dm = np.round(elev * 10).astype("<i2")  # дециметры, int16
terrain = {
    "meta": {"source": "Synthetic demo terrain", "demo": True},
    "bounds": {"west": w, "south": s, "east": e, "north": n},
    "rows": int(elev.shape[0]), "cols": int(elev.shape[1]),
    "cell_m": [round(cx, 2), round(cy, 2)],
    "elev_dm_b64": base64.b64encode(dm.tobytes()).decode(),
}

def b64img(path):
    return "data:image/jpeg;base64," + base64.b64encode((ROOT / path).read_bytes()).decode()

nova = {k: b64img(f"data/nova/{k}.jpg") for k in ["smug", "cool", "shock", "wink", "body"]}

out = ROOT / "js/assets.js"
out.write_text(
    "// Сгенерировано tools/make_assets.py. Не редактируйте вручную.\n"
    f"window.ASSETS = {{\n  marsTexture: {json.dumps(tex)},\n  marsNormal: {json.dumps(normal)},\n  demoTerrain: {json.dumps(terrain, separators=(',', ':'))},\n  nova: {json.dumps(nova)}\n}};\n"
)
print(f"{out}: {out.stat().st_size/1024:.0f} KB (текстура {len(tex)/1024:.0f} KB)")
