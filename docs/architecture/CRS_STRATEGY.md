# MARSWALK — Coordinate Reference System (CRS) Strategy

Version 1.0 · Stage 1 deliverable

## 1. Fundamental Rule

MARSWALK **never** assumes that different NASA Mars datasets share the same projection, pixel grid, or longitude domain, and **never** uses Earth `EPSG:4326` (WGS84, `a = 6,378,137 m`) or Web Mercator `EPSG:3857` for Mars geometry, distances, or slopes. Applying an Earth ellipsoid to Mars silently inflates horizontal distances by `~1.878×` and flattens computed terrain slopes by nearly half (`R-02`).

---

## 2. Native CRS Diversity Across Input Datasets

| Dataset | Native Projection / CRS | Longitude Convention | Vertical Datum |
| --- | --- | --- | --- |
| **NASA Mars Trek Global WMTS** | Geographic / Equirectangular tile matrix on Mars 2000 sphere (`R = 3,396,190 m`) | `-180° .. +180°` | N/A (rendered imagery) |
| **USGS M20 TRN CTX (20 m) & HiRISE (1 m) DTMs / Orthos** | Equidistant Cylindrical on Mars 2000 sphere (`R = 3,396,190 m`), meter units | `0° .. 360°E` in PDS/ISIS headers | MOLA areoid (`Mars_2000_Areoid`) |
| **MOLA MEGDR Global DEM (463 m)** | Simple Cylindrical (`lat_ts = 0°`) on Mars 2000 sphere | `0° .. 360°E` | MOLA areoid |
| **USGS SIM 3464 Jezero Geologic Map** | Mars 2000 projected/geographic WKT embedded in GIS package | `0° .. 360°E` | N/A (2D vector polygons) |
| **Mars 2020 `M20_traverse.json`** | Unprojected planetocentric degrees | East-positive (`~77.45°E`) | Elevation attributes where present |

Every dataset's untouched `native_crs_wkt`, resolution, and vertical datum are recorded in `datasets.native_crs_wkt` before warping or reprojection.

---

## 3. Two Canonical Mars Coordinate Systems

Both systems are registered in PostGIS `spatial_ref_sys`, GDAL/PyProj, and frontend `proj4`:

### 3.1 `SRID 949900` — Mars 2000 Planetocentric Geographic (`IAU_2015:49900`)
- **Use:** PostGIS vector geometries, GeoJSON API payloads, OpenLayers 2D base projection, CesiumJS 3D `Ellipsoid(3396190, 3396190, 3396190)`.
- **Parameters:** Sphere `a = b = 3,396,190.0 m`, prime meridian `0°`, angular unit `degree`.
- **PROJ string:** `+proj=longlat +R=3396190 +no_defs`
- **Longitude normalization & display:** Stored internally in `[-180°, +180°]` for seamless WMTS tile alignment; formatted in UI readouts and reports as planetocentric **`°N`** and east-positive **`0°–360°E`** (`lon_east = lon < 0 ? lon + 360 : lon`). Around Jezero (`77.58°E`), both representations have the exact same numeric value (`+77.58°`).

### 3.2 `SRID 949918` — Jezero Local Mars Equidistant Cylindrical (Metric Analysis Grid)
- **Use:** 20 m CTX DTM routing grid, Horn slope/aspect stencils, 1 m HiRISE roughness aggregation, and cost-surface math.
- **PROJ string:** `+proj=eqc +lat_ts=18.38 +lat_0=0 +lon_0=77.58 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs`
- **Why `lat_ts = 18.38°N`:** Equatorial equidistant cylindrical (`lat_ts = 0°`) stretches east–west ground scale at Jezero's latitude (`18.38°N`) by `sec(18.38°) ≈ 1.0538` (+5.4% horizontal error). Setting the standard parallel to `18.38°N` keeps linear scale distortion below `0.05%` across the entire Jezero study area so `dx = dy = 20.0 m` is physically accurate in all azimuths.

---

## 4. Geodesic & Elevation Safeguards

1. **Great-circle / geodesic profiles:** Polyline lengths and elevation profile sampling use `pyproj.Geod(a=3396190.0, b=3396190.0)`.
2. **Ingest assertion:** Stage 5 scripts inspect semi-major axis `a` of every raster/vector header and abort if `a` is Earth-sized (`> 6,000,000 m`).
3. **Automated verification (`AC-02`, `AC-03`):** `pytest` checks geodesic crater width (~45 km) and verifies Horn slope on a synthetic tilted plane on Mars radius within `±0.5°`.
