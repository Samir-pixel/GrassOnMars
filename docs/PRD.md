# MARSWALK — Product Requirements Document

Version 0.3 · 2026-11-14 · Stage 0 deliverable · Status: ready for approval

Companion Stage 0–1 documents in `docs/`:
- [`architecture/SYSTEM_ARCHITECTURE.md`](./architecture/SYSTEM_ARCHITECTURE.md) — approved 5-layer architecture (`DATA_FLOW.md`, `API_DESIGN.md`, `DATABASE_DESIGN.md`, `CRS_STRATEGY.md`)
- [`PROJECT_SCOPE.md`](./PROJECT_SCOPE.md) — MVP boundaries, study region, NASA-only data scope, future work
- [`USER_STORIES.md`](./USER_STORIES.md) — target users, non-users, user stories mapped to requirements
- [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) — product verification checks, stage gates, demo scenario
- [`RISKS.md`](./RISKS.md) — technical and scientific risk register

No application code exists yet. These documents fix what will be built, from which data, and how each stage is accepted.

## 1. Project vision

MARSWALK is a web-based planetary GIS and traverse-planning tool for Jezero Crater. It puts orbital and surface datasets from NASA Mars missions on one map, derives operational layers from them (slope, hazard, traverse cost), and lets a user plan, simulate and report a human surface traverse.

It is a research and demonstration tool. It is not NASA-certified, not affiliated with NASA, and its routes are computed estimates, not safety assessments.

## 2. Problem statement

Mars data that matters for a surface traverse is spread over separate archives, instruments, resolutions and formats: topography (MOLA, CTX and HiRISE DTMs), imagery (CTX, HiRISE), thermal data (THEMIS), geology (USGS map) and surface weather (MEDA). Existing viewers such as NASA Mars Trek show these layers but do not turn them into traverse decisions: where the slope is too steep, which route costs least, what science is reachable, what the environment was like at that place and season.

MARSWALK closes the gap between "viewing layers" and "planning a walk", while keeping every number traceable to its source.

## 3. Target users

Full breakdown in [`USER_STORIES.md`](./USER_STORIES.md).

| User | Need |
| --- | --- |
| Mission planner (primary) | Compare alternative traverses between two points by distance, slope, hazard exposure and time. |
| Planetary scientist | Find and prioritise geologic targets, see them in terrain context. |
| Student / educator | Explore Jezero with real data and understand how traverse planning works. |
| Demo audience / jury | Follow one clear end-to-end scenario in under 5 minutes. |

Real astronauts and flight controllers are not users: the tool is not qualified for operations.

## 4. User stories

Detailed acceptance conditions per story are in [`USER_STORIES.md`](./USER_STORIES.md).

- US-01 As a planner, I open the dashboard and see the study region, loaded datasets and their status.
- US-02 As a planner, I switch between 2D and 3D views of Jezero and toggle layers with opacity control.
- US-03 As a planner, I click any point and get elevation, slope, geologic unit and the source of each value.
- US-04 As a planner, I draw a line and get an elevation profile.
- US-05 As a planner, I see a hazard map and can read which factors produced each class.
- US-06 As a planner, I set start, end and optional waypoints and get at least three alternative routes with comparable metrics.
- US-07 As a scientist, I browse science targets, filter them by type, and add one to a route.
- US-08 As a planner, I see measured MEDA conditions for a chosen sol and their seasonal context.
- US-09 As a planner, I run a time-stepped simulation of a route and see consumables and timeline.
- US-10 As any user, I ask the assistant a question and get an answer that cites the layers it used.
- US-11 As a planner, I export a mission report with route, metrics, hazards, data sources and disclaimers.
- US-12 As any user, I can always tell whether a value is measured, derived, simulated or an assumption.

## 5. Functional requirements

Priority: M = MVP, F = future.

| ID | Module | Requirement | P |
| --- | --- | --- | --- |
| FR-01 | Dashboard | Mission summary: study region, active route, dataset status, last simulation, quick links to modules. | M |
| FR-02 | Mars Explorer | 2D map of Jezero on a Mars reference body (not an Earth CRS) with pan, zoom, coordinates readout (planetocentric latitude, east longitude), scale bar. | M |
| FR-03 | Mars Explorer | 3D terrain view with adjustable vertical exaggeration. | M |
| FR-04 | Layer Control | Toggle, reorder and set opacity for every layer; show legend, resolution, source and data class per layer. | M |
| FR-05 | Terrain Analysis | Point query (elevation, slope, aspect), elevation profile along a drawn line, slope and hillshade layers computed from the DTM. | M |
| FR-06 | Hazard Analysis | Hazard classes from a documented rule set over slope, roughness and geologic unit; per-cell explanation of contributing factors; thresholds editable. | M |
| FR-07 | Route Planner | Least-cost path over a cost raster between start, end and waypoints; at least three alternatives (shortest, lowest slope, lowest hazard); metrics: distance, ascent/descent, max slope, hazard exposure, estimated time. | M |
| FR-08 | Science Explorer | Catalogue of targets (geologic units, named features, rover-visited sites) with type filter, description, source and "add to route". | M |
| FR-09 | Environment | MEDA time series (pressure, air and ground temperature, relative humidity, and wind where available) per sol, with clear statement that data is measured at the rover position only. | M |
| FR-10 | Mission Simulation | Time-stepped traverse along a route: position, elapsed time, local solar time, consumables against a configurable budget, events at hazard cells and targets. All outputs labelled simulated. | M |
| FR-11 | AI Assistant | Question answering grounded in application data (layer metadata, route metrics, MEDA values); every answer lists sources; refuses safety certification questions. | M |
| FR-12 | Mission Reports | Printable report: route map, metrics table, hazards, targets, environment summary, data provenance table, disclaimers. | M |
| FR-13 | Provenance | Every layer and value exposes its provenance record (section 9). | M |
| FR-14 | Route Planner | Route refinement on 1 m HiRISE DTM; return-to-base and multi-day traverses. | F |
| FR-15 | Science Explorer | CRISM mineral maps as a science layer. | F |
| FR-16 | Explorer | Study regions other than Jezero. | F |

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-01 Scientific honesty | No invented data. Each displayed value carries one class: REAL, DERIVED or SIMULATED. |
| NFR-02 Reproducibility | Derived layers are produced by scripted steps from a recorded source file and parameters; re-running gives the same result. |
| NFR-03 Performance | Map interaction stays responsive on a mid-range laptop; a route across Jezero on the 20 m grid returns in under 10 s; first map view in under 5 s on broadband. |
| NFR-04 Resilience | External tile services can be slow or down: the app shows which layer failed and keeps working with locally stored data. Downloaded source data is cached on disk. |
| NFR-05 Accessibility | Keyboard reachable controls, visible focus, text contrast at WCAG AA, hazard classes distinguishable without colour alone (pattern or label). |
| NFR-06 Security | API keys stay on the server; all request parameters (coordinates, thresholds, file names) validated at the API boundary. No user accounts in MVP. |
| NFR-07 Portability | Runs locally on Windows 10/11 with documented setup; no paid service required for the core (assistant excepted). |
| NFR-08 Visual design | UI follows `DESIGN.md`: paper white `#ffffff`, charcoal `#2b2f36`, poster red `#ed2023` for actions; Borensa / Yeseva One 400 uppercase headings, Offset TM / Pangolin body; 7.2px action corners, square 2px-ruled media. Map and analysis panels use the same tokens; hazard colours are a separate scientific palette. |
| NFR-09 Disclaimers | A persistent notice states: research prototype, not NASA-certified, routes not validated for crew safety. |
| NFR-10 Language | Interface, reports and assistant answers are in Russian. Dataset titles, product ids and citations stay in their original form. No second language in the MVP. |
| NFR-11 Cyrillic type | The `DESIGN.md` fallbacks DM Serif Display and Patrick Hand have no Cyrillic glyphs (checked against Google Fonts, 2026-11-14). Russian text uses Yeseva One (headings, 400 uppercase) and Pangolin (body), both confirmed to include Cyrillic; sizes, line heights and all other `DESIGN.md` rules stay unchanged. |

## 7. Main application modules

| Module | Purpose | Depends on |
| --- | --- | --- |
| Dashboard | Entry point and mission status. | all |
| Mars Explorer | 2D/3D map canvas. | tile services, local rasters |
| Layer Control | Layer registry UI with provenance. | layer catalogue |
| Terrain Analysis | Elevation, slope, aspect, profiles. | DTM |
| Hazard Analysis | Rule-based hazard raster with explanations. | Terrain, geology |
| Route Planner | Cost raster and least-cost paths. | Hazard, Terrain |
| Science Explorer | Target catalogue. | geology map, nomenclature, rover traverse |
| Environment | MEDA observations. | PDS MEDA |
| Mission Simulation | Time-stepped traverse model. | Route, Environment |
| AI Assistant | Grounded Q&A over app data. | all read APIs, LLM provider |
| Mission Reports | Printable summary. | Route, Hazard, Science, Environment |

## 8. Scientific data requirements

"Verified" means the URL answered HTTP 200 on 2026-11-14. It does not yet mean the product was downloaded and inspected; that is Stage 5.

### 8.1 Datasets planned for the MVP

| Need | Dataset | Mission / instrument | Provider | Resolution | Access | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Global base map and context | MOLA colour shaded relief, global | Mars Global Surveyor / MOLA | NASA Mars Trek | 463 m/px | WMTS `trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml` | Verified |
| Regional elevation | MOLA MEGDR global DEM | Mars Global Surveyor / MOLA | USGS Astrogeology / PDS | 463 m/px | GeoTIFF download | To confirm in Stage 5 |
| Local elevation (routing grid) | Mars 2020 Terrain Relative Navigation CTX DTM mosaic, Jezero | MRO / CTX | USGS Astrogeology | 20 m/px | GeoTIFF download | Product known; catalogue URL failed to respond, not verified |
| High-resolution elevation | Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic, Jezero | MRO / HiRISE | USGS Astrogeology | 1 m/px | GeoTIFF download | Catalogue page verified |
| Local imagery | CTX and HiRISE orthomosaics, Jezero (companions of the DTMs above) | MRO / CTX, HiRISE | USGS Astrogeology; possibly Mars Trek | about 6 m/px and 0.25 m/px | Download or WMTS | To confirm in Stage 5 |
| Thermal context | THEMIS Day IR and Night IR global mosaics | Mars Odyssey / THEMIS | USGS / ASU; served by Mars Trek | 100 m/px | WMTS | Layer names to confirm in Stage 5 |
| Geology | Geologic Map of Jezero Crater and the Nili Planum Region (USGS SIM 3464, Sun and Stack, 2020) | compiled from MRO data | USGS | 1:75,000 | GIS package from `pubs.usgs.gov/sim/3464/` | Page verified; GIS file format to confirm |
| Surface weather | MEDA calibrated and derived data: pressure, air temperature, ground temperature, relative humidity, wind, radiation and dust sensor | Mars 2020 Perseverance / MEDA | NASA PDS Atmospheres Node | point measurements per sol | PDS4 bundle download (CSV tables with XML labels) | Node URL failed to respond, not verified |
| Rover track and sites | Perseverance traverse | Mars 2020 | NASA (mission map feed) | vector | `mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json` | Verified (JSON). Not a documented API: may change without notice, so a copy is stored locally. Waypoints file failed to respond, not verified. |
| Place names | Gazetteer of Planetary Nomenclature | IAU / USGS | USGS | vector | Download | To confirm in Stage 5 |

Notes on the source list:

- MOLA flew on Mars Global Surveyor; it is included because every Mars elevation datum depends on it.
- Owner decision: NASA sources only. The 200 m MOLA–HRSC blended DEM is not used because it contains ESA Mars Express data; regional elevation comes from the 463 m MOLA DEM instead. USGS-hosted products built from NASA mission data (CTX and HiRISE mosaics, the geologic map) count as NASA-sourced.
- "NASA Planetary Data System" is the archive, not a dataset: MEDA and the raw CTX/HiRISE/THEMIS products live there. The MVP prefers map-ready USGS and Trek products over raw PDS images to avoid a full ISIS processing pipeline.

### 8.2 Missing or unavailable data

| Wanted | Reality | MVP handling |
| --- | --- | --- |
| Real-time Mars weather | None exists publicly. PDS releases lag surface operations by months. | Use archived MEDA sols; label date of observation. |
| Weather across the crater | MEDA measures at the rover position only. | No spatial weather layer. Shown as a point series tied to rover location. |
| Weather forecast | No public forecast product. Climate models exist (for example the Mars Climate Database, which is not a NASA product). | Out of MVP; future option, labelled MODELLED. |
| Ionising radiation at Jezero | No instrument at Jezero measures it. Curiosity's RAD is in Gale Crater. MEDA's radiation sensor measures solar flux, not dose. | Not displayed as a Jezero measurement. Any dose figure in simulation is a SIMULATED parameter. |
| Complete wind record | MEDA wind sensors were damaged during the mission, so the wind record is incomplete. | Show wind only where the archive provides it; gaps stay gaps. |
| NASA InSight weather API | Mission ended in 2022 and the lander was in Elysium Planitia, not Jezero. | Not used. |
| Rock abundance raster for Jezero | No confirmed public per-pixel product. | Roughness derived from the HiRISE DTM as a proxy, labelled DERIVED. |
| Soil trafficability for walking humans | No dataset exists. | Proxy from geologic unit and slope, labelled SIMULATED. |
| Human locomotion cost on Mars | No measurements; only models and analogue studies. | One published model chosen in Stage 9, cited, labelled SIMULATED. |
| Full 1 m DTM coverage | HiRISE DTM mosaic covers the landing ellipse area, not the whole crater. | 20 m CTX grid for routing; 1 m only inside its footprint. |

## 9. Data provenance requirements

Each layer and each stored dataset has a provenance record with these fields:

- `id`, `title`, `data_class` (REAL / DERIVED / SIMULATED)
- `mission`, `instrument`, `provider`, `product_id` or citation, `doi` when one exists
- `source_url`, `retrieved_at`, `file_checksum`
- `resolution`, `coverage` (bounding box), `crs`, `vertical_datum`
- `processing` (ordered steps and parameters, empty for untouched data)
- `parents` (ids of source records for derived data)
- `license_or_usage_note`, `known_limitations`

Rules:

- A layer without a complete record is not shown.
- Derived and simulated layers inherit and display their parents.
- Reports and assistant answers print the provenance of everything they quote.
- The data class is visible wherever the value is (map legend, popups, charts, reports), not only in a details panel.

## 10. Technical constraints and decisions

Final architecture details are specified in [`architecture/SYSTEM_ARCHITECTURE.md`](./architecture/SYSTEM_ARCHITECTURE.md).

| Topic | Decision | Reason |
| --- | --- | --- |
| Reference frame | Dual Mars 2000 CRS (`SRID 949900` planetocentric geographic for display/exchange; `SRID 949918` local Jezero equidistant cylindrical at `lat_ts = 18.38°N` in meters for slope/routing; `R = 3,396,190 m`, MOLA areoid). Native CRS of every NASA dataset preserved in provenance. | Prevents assuming all NASA services share one projection and avoids silent Earth WGS84/Web Mercator distortion. |
| Client | Browser SPA in React + TypeScript + Vite + Tailwind CSS. | Typed contracts, fast iteration, clean mapping of `DESIGN.md` tokens. |
| Map engines | OpenLayers (primary 2D map with custom `proj4` Mars projections) + lazy-loaded CesiumJS (optional 3D terrain view). | OpenLayers handles custom Mars projections and 2D GIS vectors cleanly without Web Mercator assumptions; lazy CesiumJS adds 3D relief without bloating initial load. |
| Backend | Python with FastAPI, Pydantic v2, SQLAlchemy 2, GDAL/Rasterio, NumPy, SciPy, NetworkX. | Native planetary GIS ecosystem, vectorized raster analysis, and explainable graph routing. |
| Raster storage | Cloud-Optimized GeoTIFFs (COGs) + untouched checksummed raw archives on local disk (`data/`). | Multi-GB rasters stay fast via GDAL window reads without bloating DB buffers. |
| Database | PostgreSQL 16 + PostGIS 3.4 (in Docker Compose) for provenance lineage, geologic/target vectors, MEDA sols, routes, and simulations. | Spatial indexing (`GIST`), custom Mars SRIDs in `spatial_ref_sys`, and relational provenance integrity. |
| Routing | NetworkX A* over an 8-connected corridor graph built from 20 m SciPy/NumPy cost grids. | Deterministic, multi-attribute per-edge breakdowns, `< 10 s` across Jezero. |
| Infrastructure & tests | Docker Compose + Git; Pytest (scientific/API) + Playwright (E2E browser). | Reproducible PostGIS + GDAL setup on Windows without host DLL conflicts. |
| Reports | HTML page with print stylesheet, saved as PDF by the browser. | No PDF library needed. |
| Assistant | Google Gemini API called from the backend with tool access to the app's own read APIs. Key read from `GEMINI_API_KEY` in `.env` (git-ignored); model picked in Stage 12. | Owner supplied a Gemini key, confirmed working on 2026-11-14. Grounding in app data limits invented facts. Requires network; the rest of the app must work without it. |
| Data volume | HiRISE products are multi-gigabyte; 500 GB of disk is available. | Full originals are kept locally outside the repository; working copies are clipped to the Jezero study box at ingest. |
| Deployment | Local run only. | Owner did not ask for a public URL; assumed until stated otherwise. |
| Environment | Windows 10/11, local run. | Developer machine. |

## 11. MVP scope

Summary below; full scope specification in [`PROJECT_SCOPE.md`](./PROJECT_SCOPE.md).

In:
- One region: Jezero Crater and immediate surroundings (about 45 km across, centre near 18.4°N, 77.6°E).
- Layers: MOLA global base and DEM, CTX DTM and imagery, HiRISE DTM where it exists, THEMIS day and night IR, geologic map, rover traverse, place names, derived slope, hillshade, roughness, hazard.
- All eleven modules of section 7 at the depth of the M requirements.
- Russian-only UI, reports and assistant output.
- One complete demonstration scenario.

Out:
- User accounts, collaboration, cloud deployment.
- Non-NASA mission datasets, raw PDS image processing (ISIS), CRISM mineralogy, other regions.
- Weather forecasting, spatial weather fields, radiation dose maps.
- Any claim of operational or safety validity.

## 12. Future development scope

- 1 m route refinement and rock-scale hazards inside HiRISE coverage.
- CRISM mineral layers and spectral target ranking.
- Multi-day traverses, return-to-base constraints, rover-assisted traverses.
- More Mars regions; PostGIS and tile server if data volume requires.
- Uncertainty maps for DTM error and its effect on slope.
- Bilingual UI (Russian / English).

## 13. Acceptance criteria

Full verification protocol and demo script in [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md). Summary:

1. End-to-end demonstration scenario completes without errors on the developer machine.
2. Elevation at three check points matches GDAL values from the source DTM.
3. Slope on a synthetic tilted plane is within 0.5° of truth.
4. Planner never crosses no-go cells and finds the exact optimal path on a synthetic grid.
5. Three alternative routes differ and report all FR-07 metrics.
6. Every visible layer opens a complete provenance record.
7. Every value in the UI and report shows its data class (`REAL`, `DERIVED`, `SIMULATED`).
8. MEDA values for a chosen sol match the PDS CSV table.
9. Assistant cites its sources and refuses to certify astronaut safety.
10. Persistent disclaimer is visible in the app and printed in every report.
11. Offline mode after initial cache still serves local layers, terrain analysis and routing.

## 14. Main technical risks

Full risk register in [`RISKS.md`](./RISKS.md). Key risks:
- 3D terrain tiling format compatibility on Mars ellipsoid.
- Horizontal/vertical registration offsets across MOLA, CTX and HiRISE.
- Unresponsive archive endpoints or slow multi-gigabyte downloads during Stage 5.
- Silent Earth-CRS fallback in GIS libraries distorting Mars distances and slopes.
- Unvalidated hazard/cost heuristics misread as operational safety guarantees.
- LLM hallucinations if answers bypass tool-returned data.
- Scope creep across 15 stages and 11 modules.

## 15. Proposed development milestones

| # | Stage | Deliverable & exit check |
| --- | --- | --- |
| 0 | Requirements | `docs/` approved (`PRD.md`, `PROJECT_SCOPE.md`, `USER_STORIES.md`, `ACCEPTANCE_CRITERIA.md`, `RISKS.md`). |
| 1 | Architecture | Component diagram, API contract, DB schema and directory layout agreed. |
| 2 | Environment | Backend and frontend start locally; GDAL reads a Mars raster. |
| 3 | Backend | FastAPI server, health and catalogue endpoints, boundary validation tested. |
| 4 | Database | PostgreSQL + PostGIS Mars SRIDs, catalogue and provenance tables created; round-trip test passes. |
| 5 | NASA data integration | All MVP datasets downloaded/connected, checksummed, registered with full provenance. |
| 6 | Interactive map | Jezero in OpenLayers 2D (primary) and lazy CesiumJS 3D on Mars 2000 body with planetocentric readout. |
| 7 | Geospatial layers | All MVP layers toggle with opacity; point query and profile match GDAL. |
| 8 | Hazard analysis | Rule-based hazard raster with per-cell explanation; synthetic slope check passes. |
| 9 | Route planner | Three alternative least-cost routes with metrics; synthetic-grid check passes. |
| 10 | Science targets | Geologic/rover target catalogue with filter and "add to route". |
| 11 | Environment | MEDA sol viewer matching PDS source tables. |
| 12 | AI assistant | Grounded Gemini assistant in Russian with source citations and safety-certification refusal. |
| 13 | Simulation | Time-stepped traverse playback with consumables and event log. |
| 14 | Testing & presentation | All 11 product acceptance criteria pass; 5-minute demo verified. |

## 16. Owner decisions (2026-11-14)

| Question | Decision |
| --- | --- |
| LLM provider | Google Gemini API; key stored in git-ignored `.env` (`GEMINI_API_KEY`). |
| Interface language | **English** — the designer's frontend stays in English (owner decision, 2026-11-14, after the designer drop). This overrides `NFR-10` / `NFR-11` and every "Russian UI" line in the other documents; backend error messages are still `message_ru`. Language of the assistant and the report is not decided yet (`docs/BACKLOG.md`). |
| Disk space | 500 GB available locally. |
| Demonstration deadline | No fixed deadline; quality gates take precedence. |
| Data sources | NASA mission sources only (including USGS-hosted products derived from NASA missions). |
| Deployment target | Local machine (Windows 10/11). |
