# Backlog

State on 2026-11-14, after Stage 5 (NASA data) and the designer frontend drop.

## Owner decisions that changed the plan

- **UI language is English.** The designer's frontend stays as it is. This overrides `NFR-10` / `NFR-11` in `PRD.md` and the "Russian UI" lines in `PROJECT_SCOPE.md`, `ACCEPTANCE_CRITERIA.md`, `USER_STORIES.md` and `docs/architecture/*`; those lines are not rewritten yet. Backend errors remain `message_ru`.

## Done for the designer drop

- `frontend/index.html` is the designer's page (original kept as `frontend/Marswalk, Grass on Mars.html`), served by Vite with `/api` proxied to the backend; Vite binds to `127.0.0.1`.
- Elevations: `GET /api/v1/terrain/heightmap` (new, `REAL`) gives the mission map every third cell of the CTX DTM 20 m; routes, slopes and relief shading are computed from it in the browser. Point B shows its elevation from `GET /api/v1/terrain/point`.
- Imagery: CTX 6 m, HiRISE 25 cm and THEMIS day IR tiles come from `GET /api/v1/layers` and the backend tile proxy.
- Removed from the page: the embedded third-party "Jez Explore" terrain and imagery (4.4 MB, included ESA HRSC, no provenance record) and the direct NASA Trek URL. Compared before removal: the embedded grid matched our CTX DTM within 0.52 m mean absolute difference, so targets and imagery stay aligned.
- Texts in the page say what the data really is (CTX 20 m sampled at 60 m, MEDA values are samples, HiRISE DTM not loaded, free-form AI answers not connected).

## Critical

| # | Item | Why |
| --- | --- | --- |
| C1 | Zyro assistant → Gemini through the backend (`POST /api/v1/assistant/ask`, Stage 12) | The designer's assistant only answers inside a Claude artifact; here it falls back to scripted answers. Needs the owner's go-ahead: chat text goes to Google with the key from `.env`. The Gemini API docs could not be read in this session, so no endpoint was written from memory. |
| C2 | Weather in the UI is sample values | `m2020_meda_derived` / `m2020_meda_calibrated` are in the database but `/environment` is still a stub (Stage 11); the go / no-go uses a hand-set dust τ. The page says so. |
| C3 | The page needs the internet | three.js, Leaflet, lucide and Google Fonts load from CDNs; offline the map and globe do not start (`AC-11`). Vendor them into `frontend/public`. |
| C4 | Decide the language of assistant answers and the report | Follows from the English-UI decision; `message_ru` in API errors is shown nowhere in the page yet. |

## Important next

| # | Item |
| --- | --- |
| I1 | Slope, hazard and routing on the server (`DERIVED`, Stages 7–9) on the full 20 m grid; today they are client-side on a 60 m sample and nothing is stored or reproducible. |
| I2 | Science targets: the page has six editorial targets with approximate positions; `GET /api/v1/targets` has 708 real Perseverance waypoints. |
| I3 | `/terrain/profile` and `/terrain/slope` are stubs; the page computes its own elevation profile. |
| I4 | Architecture docs still describe OpenLayers + CesiumJS + React; the running map is Leaflet (`L.CRS.EPSG4326`) + three.js in one HTML file. Either adopt this formally or plan the rewrite. |
| I5 | Site-comparison data (water, terrain, science ratings, pressure) is hard-coded in the page as team assessments; it has no backend records or provenance. |

## Later

| # | Item |
| --- | --- |
| L1 | HiRISE 1 m DTM (1.84 GB), rover traverse line, USGS SIM 3464 geology. |
| L2 | Delete or revive the unused React scaffold (`frontend/src`, `index.react.html`, Tailwind / ESLint / TypeScript configs and their dependencies). `npm run build` still type-checks it. |
| L3 | `DESIGN.md` describes an unrelated style; replace it with the designer's actual tokens. |
| L4 | `scripts/dev-backend.ps1` binary choice (`.local\pg18` vs Program Files); Smart App Control is off; tests write into the shared dev database. |
| L5 | Split the 1.6 MB `index.html` (base64 images, star catalogue) into files. |
