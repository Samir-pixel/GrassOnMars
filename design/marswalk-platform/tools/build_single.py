#!/usr/bin/env python3
"""
Собирает весь сайт в один файл dist/marswalk.html: локальные CSS и JS встраиваются,
библиотеки с CDN (three.js, Leaflet, Lucide) остаются ссылками.

  python tools/build_single.py
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text()

def inline_css(m):
    href = m.group(1)
    if href.startswith("http"):
        return m.group(0)
    return f"<style>\n{(ROOT / href).read_text()}\n</style>"

def inline_js(m):
    src = m.group(1)
    if src.startswith("http"):
        return m.group(0)
    code = (ROOT / src).read_text().replace("</script", "<\\/script")
    # Снимки Езеро встраиваются как data-URI, чтобы один файл работал без папки data/
    for img in ("data/jezero_ctx.jpg", "data/jezero_hirise.jpg"):
        if f'"{img}"' in code:
            b64 = base64.b64encode((ROOT / img).read_bytes()).decode()
            code = code.replace(f'"{img}"', f'"data:image/jpeg;base64,{b64}"')
    return f"<script>\n{code}\n</script>"

html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

out = ROOT / "dist/marswalk.html"
out.parent.mkdir(exist_ok=True)
# Большие медиафайлы не встраиваются: для опубликованной страницы их адреса берутся
# из data/blob_map.json (хранилище артефакта), иначе остаются относительные пути data/...
bm = ROOT / "data/blob_map.json"
if bm.exists():
    import json as _json
    for local, remote in _json.loads(bm.read_text()).items():
        html = html.replace(f'"{local}"', f'"{remote}"')
out.write_text(html)
print(f"{out}: {out.stat().st_size / 1024:.0f} KB")
