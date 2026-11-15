# MARSWALK — Risk Register

Version 0.1 · 2026-11-14 · Stage 0 deliverable

Severity scale: **Low / Medium / High**. Every High-impact risk has a concrete check assigned to an early stage so problems surface before UI work depends on them.

## 1. Scientific & geospatial data risks

| ID | Risk | Prob. | Impact | Stage | Mitigation & fallback |
| --- | --- | --- | --- | --- | --- |
| **R-01** | **Unresponsive NASA/USGS archive URLs or slow multi-GB downloads** (PDS MEDA, USGS CTX DTM page, and M20 waypoints failed to respond during Stage 0 probe). | High | High | 5 | Download once via resumable CLI (`curl -C -`) with generous timeouts; verify SHA-256 checksums; store raw files locally on the 500 GB disk; check official PDS GeoNode / Astrogeology S3 links in Stage 5; never fetch archives at runtime. |
| **R-02** | **Earth CRS silently applied to Mars rasters/vectors** by GIS defaults (`EPSG:4326` WGS84 radius 6,378 km instead of Mars 3,396 km), corrupting distances, slopes, and speeds by ~1.88×. | Medium | High | 2, 7 | Enforce `IAU_2015` Mars 2000 CRS on ingest; compute slopes and geodesic lengths explicitly with `R = 3,396,190 m`; assert crater diameter (~45 km) in an automated Stage 7 test. |
| **R-03** | **Co-registration offsets between MOLA (463 m), CTX (20 m), and HiRISE (1 m)** create artificial cliffs at mosaic boundaries or misalign rover waypoints. | Medium | Medium | 5, 7 | Use the USGS Mars 2020 Terrain Relative Navigation orthorectified CTX/HiRISE suite (co-registered to MOLA for landing); compute slope/hazard within a single consistent DTM (20 m CTX) rather than stitching resolutions on the fly. |
| **R-04** | **Undocumented mission feeds change or disappear** (e.g., `M20_traverse.json` on `mars.nasa.gov`). | Medium | Low | 5 | Save a dated, checksummed local snapshot during Stage 5 and serve from local storage; treat remote URL as provenance metadata only. |
| **R-05** | **Incomplete sensor records in MEDA** (wind sensor damage on Perseverance, sol gaps, calibration flags). | High | Low | 5, 11 | Parse PDS quality flags, render missing intervals as explicit gaps (`null`), and document sensor limitations in UI caveats rather than interpolating fake readings. |

## 2. Algorithmic & modelling risks

| ID | Risk | Prob. | Impact | Stage | Mitigation & fallback |
| --- | --- | --- | --- | --- | --- |
| **R-06** | **Unvalidated hazard and metabolic cost models misread as real EVA safety guarantees.** | Medium | High | 8, 9, 13 | Tag outputs `DERIVED` / `SIMULATED`; expose editable thresholds and cost weights; show per-cell factor breakdowns; display persistent Russian non-certification disclaimers in UI and reports. |
| **R-07** | **20 m CTX grid misses sub-grid hazards** (1–5 m boulders, scarps, loose aeolian ripples) that could block a walking astronaut. | High | Medium | 8, 9 | Document the 20 m resolution limit in every hazard legend and report; derive local roughness from 1 m HiRISE DTM where footprints overlap, while clearly marking non-HiRISE zones as 20 m-only. |
| **R-08** | **Pathfinding latency or memory spike on large grids** if full-crater routing builds an unbounded pure-Python graph. | Medium | Medium | 9 | Keep cost surfaces as `float32` NumPy arrays (~25 MB at 20 m) and build the NetworkX `DiGraph` over a buffered waypoint corridor (excluding `No-Go` nodes up front) so A* completes in `< 10 s` with full per-edge explainability. |

## 3. Architecture, AI & UI risks

| ID | Risk | Prob. | Impact | Stage | Mitigation & fallback |
| --- | --- | --- | --- | --- | --- |
| **R-09** | **CesiumJS 3D terrain format complexity** (quantized-mesh / heightmap tile generation for custom Mars ellipsoid). | Medium | High | 6 | Build terrain tiles only for the clipped Jezero DEM using open-source terrain tilers (`ctb-tile` / custom heightmap provider over GeoTIFF windows); fallback is custom Mars-ellipsoid heightmap provider fed directly from backend DEM tiles. |
| **R-10** | **LLM hallucination or fabricated NASA citations** in AI Assistant answers. | Medium | High | 12 | Restrict Gemini via system prompt + structured read-only tools returning PostGIS/API records; require provenance IDs in answers; add automated refusal & citation tests; keep core app independent of LLM availability. |
| **R-11** | **Exposed API key** (the Gemini key was pasted in chat during Stage 0). | High | Medium | 0, 14 | Stored strictly in `.env` listed in `.gitignore`; never bundled into frontend code; owner advised to rotate key in Google AI Studio after development. |
| **R-12** | **Poster aesthetic (`DESIGN.md`) clashes with dense GIS controls or lacks Cyrillic glyphs.** | Medium | Medium | 6, 14 | Apply poster typography (`Yeseva One` + `Pangolin` for Cyrillic), `#ffffff`/`#2b2f36`/`#ed2023` palette, and halftone/star accents to navigation, dashboard, headers, and reports; keep map overlays compact with dedicated colour-blind-safe scientific legends. |
| **R-13** | **Scope creep across 15 sequential stages and 11 modules.** | Medium | High | 1–14 | Enforce `AGENTS.md` rule ("smallest complete change"): ship minimal working implementation of each stage, pass its exit check, and defer all `F` (Future) items in `PROJECT_SCOPE.md`. |
