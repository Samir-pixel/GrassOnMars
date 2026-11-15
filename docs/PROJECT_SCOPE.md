# MARSWALK — Project Scope

Version 0.1 · 2026-11-14 · Stage 0 deliverable

## 1. Geographic & planetary boundary

- **Target body:** Mars (`IAU_2015` Mars 2000 sphere, radius 3,396,190 m; planetocentric latitude, east-positive longitude 0°–360°E; MOLA areoid vertical datum).
- **Study region:** Jezero Crater and immediate rim/inlet surroundings, centred near `18.38°N, 77.58°E` (bounding box fixed in Stage 5 to match the Mars 2020 CTX mosaic footprint, roughly `17.8°N–18.9°N`, `77.0°E–78.2°E`).
- **Other Mars regions:** Out of scope for MVP. Global MOLA WMTS is used strictly as background context when zoomed out.

## 2. Functional scope (MVP — in scope)

All 11 application modules are included in the MVP at minimum complete depth:

1. **Dashboard:** Study region status, loaded dataset summary, active route card, latest simulation summary, persistent disclaimer.
2. **Mars Explorer:** 2D and 3D map views (CesiumJS), coordinate readout, scale bar, vertical exaggeration slider.
3. **Layer Control:** Visibility toggle, z-order, opacity slider, legend, resolution badge, data class badge, provenance modal.
4. **Terrain Analysis:** Click-point elevation/slope/aspect readout, interactive line elevation profile, derived slope and hillshade rasters.
5. **Hazard Analysis:** Configurable rule-based hazard classification (slope + DTM roughness + geologic unit proxy), per-cell factor breakdown.
6. **Route Planner:** Start/end/waypoint selection on the 20 m CTX grid, three distinct least-cost profiles (shortest distance, minimum slope, minimum hazard), comparative metrics table.
7. **Science Explorer:** Filterable catalogue of Jezero geologic units (USGS SIM 3464), IAU named features, and Perseverance traverse sites; one-click insertion into route waypoints.
8. **Environment:** Archived Perseverance MEDA per-sol time series (pressure, air/ground temperature, relative humidity, available wind) explicitly scoped to the rover's coordinates and observation sol.
9. **Mission Simulation:** Time-stepped playback along a planned route tracking position, elapsed duration, local true solar time, configurable consumable budgets, and hazard/target events.
10. **AI Assistant:** Russian-language Q&A backed by Google Gemini with read-only tools querying loaded provenance, route metrics, terrain stats, and MEDA records.
11. **Mission Reports:** Browser-printable Russian mission briefing containing route map, metrics, hazard summary, science stops, MEDA context, full provenance table, and mandatory disclaimers.

## 3. Data scope (NASA-only policy)

### Included sources
- **Mars Global Surveyor (MOLA):** Global colour shaded relief WMTS (NASA Mars Trek) and MEGDR 463 m DEM.
- **Mars Reconnaissance Orbiter (CTX & HiRISE):** Mars 2020 Terrain Relative Navigation 20 m CTX DTM/orthomosaic and 1 m HiRISE DTM/orthomosaic (hosted by USGS Astrogeology from NASA MRO data).
- **Mars Odyssey (THEMIS):** Day IR and Night IR 100 m global mosaics via NASA Mars Trek.
- **MRO-derived Geologic Map:** USGS SIM 3464 (*Geologic Map of Jezero Crater and the Nili Planum Region*, Sun & Stack, 2020).
- **Mars 2020 Perseverance:** MEDA PDS4 atmospheric bundles (NASA PDS Atmospheres Node) and rover traverse GeoJSON snapshot.
- **Planetary Nomenclature:** IAU/USGS Gazetteer features inside the Jezero bounding box.

### Excluded sources
- Non-NASA mission products (e.g., ESA Mars Express HRSC, ExoMars TGO, Mars Climate Database).
- Retired or off-site landers (e.g., InSight in Elysium Planitia, Curiosity RAD in Gale Crater).
- Raw unprocessed PDS EDR imagery requiring a local USGS ISIS photogrammetric pipeline.

### Honest handling of unavailable data
Every gap where no NASA measurement exists in Jezero (real-time weather, spatial weather fields, ionising radiation dose, human regolith trafficability, metabolic cost on Mars) is either omitted or represented as an explicit model parameter tagged `DERIVED` or `SIMULATED` — never presented as `REAL`.

## 4. Localization & UI scope

- **Language:** Russian (`ru`) across all UI labels, error messages, assistant responses, and generated reports. Original English dataset titles, PDS product IDs, and bibliographic citations remain untranslated for scientific traceability.
- **Design system:** Follows `DESIGN.md` tokens (`#ffffff`, `#2b2f36`, `#ed2023`, 7.2px button radius, 2px dark image/map frames) adapted with Cyrillic-capable fonts (`Yeseva One` for 400 uppercase display/headings, `Pangolin` for body/controls).

## 5. Explicit exclusions (out of MVP)

- Authentication, user accounts, multi-user collaboration, cloud hosting.
- Sub-meter boulder detection or 1 m HiRISE pathfinding across the full crater (HiRISE covers only the landing corridor).
- CRISM hyperspectral mineral processing.
- Real-time telemetry ingestion or weather forecasting.
- Multi-sol habitats, rover-pressurized traverses, or life-support engineering certification.
- Any claim of NASA endorsement, flight qualification, or astronaut safety validation.

## 6. Post-MVP (future scope)

- Local 1 m route refinement inside the HiRISE DTM footprint.
- CRISM mineral indicator overlays.
- Return-to-base abort routing and multi-day EVA scheduling.
- Uncertainty propagation from DTM vertical error into slope and route cost.
- Additional Mars landing site regions and optional English UI toggle.
