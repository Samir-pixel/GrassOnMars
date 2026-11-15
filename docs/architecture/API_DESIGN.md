# MARSWALK — API Design, Validation, Caching & Testing

Version 1.0 · Stage 1 deliverable

## 1. API Conventions

- **Base prefix:** `/api/v1` (interactive OpenAPI / Swagger UI served at `/docs` and `/redoc`).
- **Provenance envelope:** Every scientific readout carries `data_class` (`REAL` | `DERIVED` | `SIMULATED`) and `provenance_ids: list[str]`.
- **Localization:** User-facing messages and labels are in Russian (`NFR-10`); dataset product IDs and citations keep their canonical archival strings.

---

## 2. Endpoint Catalogue

| Method & Path | Module | Responsibility |
| --- | --- | --- |
| `GET /api/v1/health` | Core | Service status, PostgreSQL/PostGIS probe, `data/` storage check, Gemini config flag (never leaks secrets). |
| `GET /api/v1/dashboard/summary` | Dashboard | Study region bounds, dataset counts (`online`/`cached`/`missing`), latest route & simulation summary. |
| `GET /api/v1/layers` | Layer Control | Registered layers with complete provenance, bounds, resolution, and legend definition. `service` holds the tile URL template, native CRS, zoom range and attribution. |
| `GET /api/v1/tiles/{layer_id}/{z}/{row}/{col}` | Map | WMTS tile through the caching proxy to NASA Mars Trek. `404 TILE_NOT_FOUND` / `LAYER_NOT_FOUND`, `502 UPSTREAM_UNAVAILABLE` / `UPSTREAM_INVALID_DATA`, `503 UPSTREAM_RATE_LIMITED`, `504 UPSTREAM_TIMEOUT`. |
| `GET /api/v1/layers/{layer_id}/provenance` | Provenance | Full dataset metadata, native CRS WKT, SHA-256 checksum, processing steps, and recursive parent lineage. |
| `GET /api/v1/tiles/{layer_id}/{z}/{x}/{y}.png` | Explorer / Layers | Renders local COG raster tiles or proxies/caches NASA Mars Trek WMTS tiles. |
| `GET /api/v1/terrain/heightmap` | Terrain Analysis | Elevation grid of a `west/south/east/north` window (`REAL`): every `step`-th cell (1–50) of the CTX DTM 20 m, values unchanged, rows north to south, float32 LE in base64, `NaN` = no data; returns the outer bounds of the sampled blocks and `cell_m` (W–E, N–S ground spacing). At most 400 000 cells. `422 OUTSIDE_COVERAGE`, `422 GRID_SIZE`, `503 DATASET_NOT_ACQUIRED`. The mission map plans routes on this grid (`step=3`). |
| `GET /api/v1/terrain/point` | Terrain Analysis | Elevation at `(lat, lon)` (`REAL`): the CTX DTM 20 m cell, outside its footprint the MOLA 463 m cell, no interpolation; returns `provenance_ids`, `resolution_m`, `vertical_datum`, cell centre. `422 OUTSIDE_COVERAGE`, `503 DATASET_NOT_ACQUIRED`. Slope, aspect, roughness and geologic unit are planned (`DERIVED`). |
| `POST /api/v1/terrain/profile` | Terrain Analysis | Geodesic distance vs. elevation & slope profile along a drawn polyline on Mars (`R = 3,396,190 m`). |
| `POST /api/v1/hazards/evaluate` | Hazard Analysis | Validate custom slope/roughness/unit thresholds and return hazard summary / tile parameters. |
| `GET /api/v1/hazards/cell` | Hazard Analysis | Per-cell factor breakdown (`slope_deg`, `roughness_m`, `unit_code`, resulting hazard class, triggered rule). |
| `POST /api/v1/routes/plan` | Route Planner | Compute 3 least-cost routes (*Кратчайший*, *Минимальный уклон*, *Минимальный риск*) and metrics. |
| `GET /api/v1/routes/{route_set_id}` | Route Planner | Retrieve persisted route geometries and metrics. |
| `GET /api/v1/science/targets` | Science Explorer | Filter geologic outcrops, IAU features, and Perseverance waypoints by category/bbox/query. |
| `GET /api/v1/environment/sols` | Environment | List archived MEDA sols with `Ls`, Earth date, and per-sensor completeness flags. |
| `GET /api/v1/environment/sols/{sol}` | Environment | Per-sol MEDA time series (preserving `null` sensor gaps) + rover location caveat. |
| `POST /api/v1/simulations/run` | Simulation | Time-stepped EVA traverse simulation over a route and consumable budget (`SIMULATED`). |
| `POST /api/v1/assistant/ask` | AI Assistant | Grounded Russian Q&A via Gemini read-only tools + safety-certification refusal guard. |
| `GET /api/v1/reports/{route_set_id}` | Mission Reports | Complete printable Russian report payload including provenance table and disclaimers. |

---

## 3. Input Validation & Error Handling

### Boundary validation (Pydantic v2)
- **Coordinates:** `lat` in `[-90.0, 90.0]` (planetocentric), `lon` in `[-180.0, 360.0]`, `allow_inf_nan=False`. Local terrain/routing endpoints enforce containment inside the Jezero DTM footprint.
- **Identifiers:** `layer_id` and `dataset_id` match `^[a-z0-9_-]{3,64}$` and resolve via database lookup — raw file paths are never accepted from requests.
- **Thresholds:** Hazard slope/roughness thresholds must be finite, non-negative, and strictly monotonic (`low < caution < high < no_go`).

### Unified error response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message_ru": "Координаты выходят за пределы расчётной сетки кратера Езеро.",
    "details": {},
    "request_id": "2c8d4f1a"
  }
}
```

---

## 4. Caching, Logging & Testing Strategy

- **Caching (no Redis required):**
  1. Persistent disk cache (`data/processed/wmts_cache/`) for NASA Mars Trek WMTS tiles (`AC-11` offline support).
  2. Precomputed COGs (`data/processed/`) for baseline slope, hillshade, roughness, and hazard layers.
  3. In-memory LRU (`functools.lru_cache`) holding the ~25 MB 20 m Jezero analysis arrays in backend RAM.
  4. Browser `Cache-Control` headers on immutable tile responses.
- **Logging:** Structured JSON logs on stdout with `request_id`, HTTP method, path, status code, and `duration_ms`; sensitive env vars (`GEMINI_API_KEY`, `POSTGRES_PASSWORD`) are redacted.
- **Testing:**
  - `pytest` unit tests: Mars geodesic distances, synthetic tilted-plane slope (`±0.5°`), synthetic-grid A* optimality & `No-Go` avoidance, provenance completeness, AI refusal guard.
  - `pytest` integration tests: FastAPI endpoints, boundary `422` validation, GDAL vs. API elevation match (`<= 0.01 m`), MEDA CSV parity.
  - `Playwright` E2E tests: Full 10-step Russian demo scenario from Dashboard to printable report.
