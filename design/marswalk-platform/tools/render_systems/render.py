from playwright.sync_api import sync_playwright
import sys, json
jobs = json.loads(sys.argv[1])
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
    for name, qs in jobs:
        pg = b.new_page(viewport={"width":900,"height":700})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
        pg.goto(f"http://localhost:8810/r.html?{qs}")
        try:
            pg.wait_for_function("window.done", timeout=180000)
            pg.locator("canvas").screenshot(path=f"/tmp/rend/out_{name}.png", omit_background=True)
            print(name, pg.evaluate("window.done"), errs[:2])
        except Exception as e:
            print(name, "FAIL", errs[:3], str(e)[:100])
        pg.close()
    b.close()
