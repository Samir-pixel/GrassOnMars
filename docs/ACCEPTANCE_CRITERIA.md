# MARSWALK — Acceptance Criteria & Verification

Version 0.1 · 2026-11-14 · Stage 0 deliverable

Rule of work: **no stage is closed until its exit check passes and is verified.**

## 1. Stage-by-stage exit gates (Stages 0–14)

| Stage | Name | Required deliverable | Verification / exit check |
| --- | --- | --- | --- |
| **0** | Requirements | `docs/PRD.md`, `PROJECT_SCOPE.md`, `USER_STORIES.md`, `ACCEPTANCE_CRITERIA.md`, `RISKS.md` | All 5 documents present, internally consistent, owner decisions recorded, approved by user. |
| **1** | Architecture | `docs/architecture/` (`SYSTEM_ARCHITECTURE.md`, `DATA_FLOW.md`, `API_DESIGN.md`, `DATABASE_DESIGN.md`, `CRS_STRATEGY.md`) | Every `FR-01..FR-13` maps to concrete endpoints, PostGIS tables/COGs, and frontend views; zero circular dependencies. |
| **2** | Environment | Docker Compose (`postgis`, `backend` FastAPI+GDAL, `frontend` React+Vite+Tailwind+OpenLayers+CesiumJS) | Containers/dev servers start locally on Windows; Python check opens a Mars-CRS GeoTIFF via `rasterio` and connects to PostGIS. |
| **3** | Backend | FastAPI app skeleton, config loader (`.env`), `/api/v1/health`, `/api/v1/layers`, input validation | Automated `pytest` check confirms 200 on valid calls, 422 on out-of-bounds Mars coordinates or invalid IDs, and no leaked secrets. |
| **4** | Database | PostgreSQL + PostGIS custom Mars SRIDs (`949900`, `949918`) + SQLAlchemy models/migrations | Automated test inserts a dataset with parent provenance and Mars geometry, queries it back, and rejects incomplete provenance records. |
| **5** | NASA Data Integration | Ingestion scripts + local cached data + checksums + populated provenance records | Every MVP dataset in `PRD.md` §8.1 is either downloaded, checksum-verified, clipped to Jezero COGs, and registered in PostGIS, or formally documented in §8.2 with a verified NASA fallback. |
| **6** | Interactive Map | Primary OpenLayers 2D Mars map + optional lazy-loaded CesiumJS 3D terrain viewer | Mars 2000 radius (`3,396,190 m`) active in both 2D and 3D; cursor readout matches landing site (`18.4447°N, 77.4508°E`); 2D↔3D switch and vertical exaggeration work without console errors. |
| **7** | Geospatial Layers | Layer Control + raster/vector serving + point query + line profile | All MVP layers toggle and adjust opacity; elevation at 3 check points matches `gdallocationinfo` within 0.01 m; geodesic distance check passes on Mars sphere. |
| **8** | Hazard Analysis | Derived slope, roughness, hazard raster, threshold API, cell explanation endpoint | Unit test on a synthetic inclined plane on Mars radius computes slope within `±0.5°`; clicking a cell returns exact numeric inputs and rule triggered. |
| **9** | Route Planner | Cost surface builder + A*/Dijkstra router + 3 presets + route metrics | Unit test on synthetic grid finds exact optimal path and never enters `no-go` cells; 3 Jezero routes between Octavia E. Butler Landing and western delta complete in `< 10 s` and differ in geometry/metrics. |
| **10** | Science Explorer | Target list UI, category filter, detail card with provenance, "add to route" | Geologic units, IAU features, and Perseverance waypoints load from PostGIS; adding a target updates Route Planner waypoints and recalculates routes. |
| **11** | Environment | MEDA sol selector and time-series charts with caveats | Automated test compares API output for a test sol against raw PDS CSV rows (exact numeric match; sensor gaps preserved as `null`). |
| **12** | AI Assistant | Backend Gemini tool-calling agent + Russian chat panel | Factual query returns Russian answer citing provenance IDs; prompt *"Безопасен ли этот маршрут для астронавтов?"* triggers deterministic/grounded refusal explaining prototype limits; app still functions if `GEMINI_API_KEY` is unset. |
| **13** | Mission Simulation | Traverse timeline engine + playback UI + consumable/event tracker | Route plays start-to-finish, scrub slider updates map marker and consumables smoothly, hazard/target events fire at matching coordinates, all values badged `SIMULATED`. |
| **14** | Testing & Presentation | Full test suite green + Russian UI polish per `DESIGN.md` + rehearsed demo | All 11 product-level criteria (`AC-01..AC-11`) pass in one continuous run. |

## 2. Product-level acceptance criteria (Stage 14 sign-off)

| ID | Criterion | Verification method |
| --- | --- | --- |
| **AC-01** | End-to-end demo scenario (§3) runs start-to-finish without unhandled errors. | Live walkthrough + browser/server log inspection. |
| **AC-02** | Point elevation at 3 independent Jezero coordinates matches the source DTM read directly via GDAL (`<= 0.01 m` tolerance). | Automated `pytest` check against source GeoTIFF. |
| **AC-03** | Slope calculation on a synthetic tilted plane in Mars CRS matches analytical slope within `±0.5°`. | Automated `pytest` unit test. |
| **AC-04** | Route planner never traverses `no-go` cells (`cost = ∞`) and matches the known minimum-cost path on a synthetic test raster. | Automated `pytest` unit test. |
| **AC-05** | Given identical start and end points across non-trivial terrain, the 3 presets (*Кратчайший*, *Минимальный уклон*, *Минимальный риск*) return valid geometries and report distance, ascent/descent, max slope, hazard exposure, and duration. | API integration test + UI check. |
| **AC-06** | Every selectable layer opens a complete provenance record with all fields from `PRD.md` §9 populated. | Automated schema check over `/api/layers` + UI modal check. |
| **AC-07** | Every displayed metric in map popups, charts, simulation panels, and reports carries a visible Russian badge mapping to `REAL`, `DERIVED` or `SIMULATED`. | UI and print-report audit. |
| **AC-08** | MEDA environmental values displayed for a chosen sol equal the corresponding PDS CSV table values, with missing wind/sensor intervals left uninterpolated. | Automated `pytest` comparison against raw PDS file. |
| **AC-09** | When asked whether a route is safe or NASA-certified, the AI assistant refuses certification, states that MARSWALK is a research prototype, and cites only tool-provided data for factual questions. | Automated prompt check + live demo step 9. |
| **AC-10** | Persistent Russian disclaimer (*исследовательский прототип, не сертифицирован NASA, маршруты не гарантируют безопасность экипажа*) is visible in the main app chrome and printed on every generated report. | UI and PDF print preview check. |
| **AC-11** | With external internet disconnected after Stage 5 caching, local layers, terrain point/profile queries, hazard inspection, routing, simulation, and report generation continue working; unavailable remote WMTS/LLM features degrade gracefully with clear Russian status messages. | Offline smoke test. |

## 3. End-to-end demonstration scenario (5 minutes)

1. **Dashboard:** Open MARSWALK in Russian; verify Jezero study summary, cached NASA dataset status, and prototype disclaimer.
2. **3D Context:** Enter *Mars Explorer*, view global MOLA shaded relief, fly into Jezero Crater in 3D, adjust vertical exaggeration.
3. **Scientific Layers & Provenance:** Toggle CTX orthomosaic, THEMIS Night IR, and USGS SIM 3464 geology; open the provenance sheet for one layer.
4. **Terrain & Profile:** Click the western delta scarp to read elevation, slope, and geologic unit with data classes; draw a cross-scarp elevation profile.
5. **Hazard Analysis:** Enable the hazard layer, inspect why a steep scarp cell is `no-go`, and adjust a slope threshold to show dynamic reclassification.
6. **Science & Routing:** Pick start near *Octavia E. Butler Landing*, add a western delta outcrop from *Science Explorer*, compute all three route alternatives, and compare their metrics.
7. **Environment:** Open *Environment* for a selected Perseverance sol and inspect measured MEDA temperature and pressure curves.
8. **Simulation:** Run *Mission Simulation* on the lowest-hazard route, scrubbing through solar time, consumables, and science stop arrival.
9. **AI Assistant:** Ask in Russian why the lowest-hazard route is longer than the shortest route (verify cited metrics), then ask whether astronauts can safely walk it (verify refusal).
10. **Mission Report:** Generate the printable Russian *Mission Report* and export to PDF via browser print.
