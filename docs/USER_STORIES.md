# MARSWALK — User Stories

Version 0.1 · 2026-11-14 · Stage 0 deliverable

## 1. Personas

| Persona | Role | Primary goal |
| --- | --- | --- |
| **Mission Planner** (primary) | Surface EVA analyst | Build, compare, and document candidate walking routes across Jezero Crater with transparent terrain and hazard trade-offs. |
| **Planetary Scientist** | Geologist / target lead | Locate contact zones, delta outcrops, and rover-sampled sites, inspect their terrain context, and include them as traverse waypoints. |
| **Student / Educator** | University or STEM learner | Explore real NASA Mars datasets interactively and see how orbital measurements become operational traverse plans. |
| **Demo Reviewer / Jury** | Technical evaluator | Verify scientific honesty, data provenance, algorithmic correctness, and end-to-end usability in a 5-minute walkthrough. |

### Non-users (explicitly excluded)
- **Flight crews and operational EVA flight controllers:** MARSWALK is an uncertified research prototype and must never be used for real human safety decisions.

## 2. User stories & traceability

### US-01 — Mission overview on Dashboard
- **Story:** As a Mission Planner, I open the Dashboard so that I immediately see the Jezero study region, dataset readiness, active route summary, and prototype disclaimer.
- **Maps to:** `FR-01`, `NFR-09`, `NFR-10` · Module: *Dashboard*
- **Done when:** Dashboard renders in Russian, lists every registered dataset with online/cached/missing status, shows the safety disclaimer, and links into Mars Explorer.

### US-02 — 2D/3D Mars exploration and layer control
- **Story:** As a Mission Planner, I switch smoothly between 2D map and 3D terrain views of Jezero and toggle scientific layers with opacity sliders so that I can visually correlate imagery, thermal inertia, and topography.
- **Maps to:** `FR-02`, `FR-03`, `FR-04` · Modules: *Mars Explorer*, *Layer Control*
- **Done when:** Coordinates read in planetocentric `°N, °E` on the Mars 2000 sphere, vertical exaggeration adjusts 3D relief, and every toggled layer shows its legend and `data_class` badge.

### US-03 — Point terrain & geology inspection
- **Story:** As a Mission Planner, I click any point in Jezero to read elevation, slope, aspect, and geologic unit alongside the exact dataset each number came from.
- **Maps to:** `FR-05`, `FR-13` · Module: *Terrain Analysis*
- **Done when:** Clicking a point displays values matching GDAL inspection of the underlying raster/vector layers, each tagged with `REAL` or `DERIVED` and linked to its provenance record.

### US-04 — Interactive elevation profile
- **Story:** As a Mission Planner, I draw a polyline across a crater rim or delta scarp to inspect an elevation and slope cross-section before committing to a route.
- **Maps to:** `FR-05` · Module: *Terrain Analysis*
- **Done when:** Drawing a 2+ vertex line plots distance (m, Mars sphere geodesic) vs. elevation (m, MOLA areoid) and highlights maximum slope along the segment.

### US-05 — Explainable hazard mapping
- **Story:** As a Mission Planner, I view a classified surface hazard layer, adjust its slope/roughness thresholds, and click any cell to read why it received its hazard rating.
- **Maps to:** `FR-06`, `NFR-05` · Module: *Hazard Analysis*
- **Done when:** Hazard classes (e.g., low, caution, high, no-go) update deterministically when thresholds change, use accessible labels/patterns in addition to colour, and expose exact contributing values per cell.

### US-06 — Multi-alternative route planning
- **Story:** As a Mission Planner, I place start, end, and optional waypoints and compute at least three alternative traverses (shortest, lowest slope, lowest hazard) with side-by-side metrics.
- **Maps to:** `FR-07`, `NFR-03` · Module: *Route Planner*
- **Done when:** Three routes return in under 10 s on the 20 m CTX grid, avoid `no-go` cells, and report total distance, cumulative ascent/descent, max slope, hazard exposure %, and estimated duration.

### US-07 — Scientific target discovery & waypoint insertion
- **Story:** As a Planetary Scientist, I browse Jezero science targets, filter by category (geologic unit, delta feature, Perseverance waypoint), read source notes, and add selected targets to my traverse.
- **Maps to:** `FR-08`, `FR-13` · Module: *Science Explorer*
- **Done when:** Selecting "Добавить в маршрут" inserts the target coordinates into the Route Planner waypoint list and preserves its citation for the final report.

### US-08 — Historical surface environment review
- **Story:** As a Mission Planner, I select an archived Perseverance sol and view MEDA pressure, air/ground temperature, humidity, and available wind measurements with clear spatial/temporal caveats.
- **Maps to:** `FR-09`, `NFR-01` · Module: *Environment*
- **Done when:** Charts plot values identical to the ingested PDS MEDA CSV for that sol, leave missing sensor intervals blank (never interpolated silently), and state that measurements apply only to the rover's location.

### US-09 — Time-stepped Marswalk simulation
- **Story:** As a Mission Planner, I run a simulation along a chosen route to observe astronaut progression, local solar time, consumable drawdown, and encounters with high-slope segments or science stops.
- **Maps to:** `FR-10`, `NFR-01` · Module: *Mission Simulation*
- **Done when:** Play/pause/scrub controls step along the route geometry, update simulated oxygen/water/battery/time against editable assumptions, log events, and badge all outputs `SIMULATED`.

### US-10 — Grounded AI mission assistant
- **Story:** As any user, I ask questions in Russian about the loaded layers, planned routes, or MEDA sols and receive concise answers that cite exact app records — while refusing to declare any route safe for real astronauts.
- **Maps to:** `FR-11`, `NFR-01`, `NFR-10` · Module: *AI Assistant*
- **Done when:** Every factual claim references a provenance ID or route/sol record returned by backend tools, missing data is stated plainly, and safety-certification prompts trigger an explicit refusal explaining prototype limits.

### US-11 — Printable mission report
- **Story:** As a Mission Planner, I generate a clean Russian mission report summarizing the selected traverse, alternatives, hazards, science stops, environmental baseline, data provenance, and disclaimers.
- **Maps to:** `FR-12`, `FR-13`, `NFR-08`, `NFR-09` · Module: *Mission Reports*
- **Done when:** Report opens in a print-ready layout following `DESIGN.md` typography/colours and exports cleanly to PDF via browser print with all provenance records and safety disclaimers intact.

### US-12 — End-to-end provenance & data-class transparency
- **Story:** As a Demo Reviewer, I can tell at a glance everywhere in the UI whether any number is `REAL`, `DERIVED` or `SIMULATED`, and inspect its full lineage back to a NASA archive file.
- **Maps to:** `FR-13`, `NFR-01`, `NFR-02` · Module: *All modules*
- **Done when:** No layer renders without a valid provenance record, derived layers link to their parent datasets and processing parameters, and every numeric readout displays its data class badge.
