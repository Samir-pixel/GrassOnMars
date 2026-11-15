# NASA Data Sources — Integration Research (Stage 5.3)

Scope: real data for Jezero Crater. Every endpoint below was requested from the development
machine on **2026-11-14**; the "Verified" column says what the request actually returned.
Nothing here is taken from memory. Items that were not checked are listed in section 6.

## 1. Kinds of source

| Kind | Meaning | Examples here |
| --- | --- | --- |
| Live service | Answers per request, no file handling | Mars Trek WMTS, Trek layer catalogue, Mars 2020 raw-image API, PDS Search API, ODE REST |
| Preprocessed map layer | Mosaic already tiled for display (8-bit picture, not measurements) | All Trek layers |
| Archived scientific product | File with physical values, downloaded and processed locally | USGS GeoTIFF DEMs/DTMs, PDS4 MEDA tables |
| Raw instrument observation | Unprocessed or browse-level instrument output | Mars 2020 raw images, MEDA `data_raw_env` |

## 2. Dataset integration matrix

| # | Source / product | Official URL (verified) | Access | Format | Resolution | Coverage | Native CRS | Observation time | Processing level | Complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Mars Trek WMTS** — MOLA colour shaded relief | `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml` | RESTful WMTS, per-layer GetCapabilities | JPEG tiles 256 px | product 463 m; pyramid levels 0–7 | Global | `urn:ogc:def:crs:EPSG::104905` (lon/lat degrees) | Not given by the service (mosaic) | Visual mosaic | Low |
| 1 | Mars Trek WMTS — MOLA+HRSC blend shade | `…/Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml` | same | JPEG | 200 m; levels 0–8 | Global | same | Not given | Visual mosaic | Low |
| 2 | **MOLA DEM** (MEGDR, USGS edition) | page `https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m`; file `https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` | HTTPS file, `Range` supported | GeoTIFF, 16-bit, 46080×23040, **2.13 GB** | 463.0836 m (128 px/deg) | Global | Simple Cylindrical, planetocentric, +East, sphere 3 396 190 m | Edition 2003-03-21 | Gridded DEM | Medium–High |
| 2 | **CTX DTM, Jezero** (Mars 2020 TRN) | page `https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic`; file `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` | HTTPS file | GeoTIFF float32, 1596×1512, uncompressed, **9.7 MB** | 20 m | 77.1605–77.699°E, 18.211–18.7212°N | Equirectangular, Mars 2000 sphere, lat_ts 0, lon_0 0 | Published 2020-07-24 | DTM controlled to MOLA | **Low** |
| 3 | **HiRISE DTM, Jezero** (Mars 2020 TRN) | `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif` | HTTPS file, `Range` supported | GeoTIFF float32, 21400×21488, uncompressed, **1.84 GB** | 1 m | Jezero landing ellipse | Equirectangular, Mars 2000 sphere | — | DTM mosaic | High (size) |
| 3 | HiRISE orthomosaic, Jezero (Trek) | `…/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml` | WMTS | PNG | 25 cm; levels 0–17 | 77.223–77.584°E, 18.307–18.669°N | EPSG::104905 | Not given | Controlled visual mosaic | Low |
| 3 | CTX orthomosaic, Jezero (Trek) | `…/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml` | WMTS | PNG | 6 m; levels 0–13 | 77.160–77.699°E, 18.211–18.721°N | EPSG::104905 | Product created 2020-08-03 | Controlled visual mosaic | Low |
| 4 | **THEMIS Day IR** controlled mosaic v2 (Trek) | `…/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml` | WMTS | PNG | 100 m; levels 0–9 | ±65° latitude, all longitudes | EPSG::104905 | Not given | Controlled visual mosaic | Low |
| 4 | THEMIS Night IR controlled mosaic v2 (Trek) | `…/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml` | WMTS | PNG | 100 m; levels 0–9 | ±65° latitude | EPSG::104905 | Not given | Controlled visual mosaic | Low |
| 5 | **Perseverance waypoints** | `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json` | Static GeoJSON | GeoJSON points (708 features, sols 13–2022) | per localisation | Rover traverse | lon/lat degrees, elevation in metres | `sol` per feature | Mission localisation product | Low |
| 5 | Perseverance traverse path | `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json` | Static GeoJSON | GeoJSON LineStrings | per drive | Rover traverse | declared `CRS84` in the file | `sol`, SCLK start/end | Mission localisation product | Low |
| 5 | Mars 2020 raw images | `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json` | JSON API, paged | JSON + JPEG/PNG links | camera dependent | Rover position | camera models, no map projection | `date_taken_utc`, `sol` | **Raw / browse** | Low (list), High (georeferencing) |
| 6 | **MEDA** PDS4 bundle | `https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/` | HTTPS directory tree | PDS4 XML labels + tables | per second / per sol | Point, at the rover | none (rover location in ancillary table) | per record; `data_derived_env` covers sols 0–1859 | raw → partially processed → calibrated → derived | Medium |
| 8 | PDS Search API | `https://pds.nasa.gov/api/search/1/products` (redirects to `pds.mcp.nasa.gov`) | REST JSON | JSON | — | All PDS4 holdings (93.7 M products) | — | per product | index only | Medium |
| 8 | PDS Geosciences ODE REST | `https://oderest.rsl.wustl.edu/live2/?query=…&output=JSON` | REST JSON | JSON | — | Orbital product footprints | — | per product | index only | Medium |
| 8 | PDS Geosciences Mars 2020 | `https://pds-geosciences.wustl.edu/missions/mars2020/` | HTTPS directory tree | PDS4 | — | Rover science instruments | — | per product | archive | Medium–High |
| 8 | HiRISE PDS | `https://hirise-pds.lpl.arizona.edu/PDS/` | HTTPS directory tree | PDS3 JP2/IMG | 25–50 cm | per image strip | per product | per product | EDR / RDR / DTM | High |

The Trek layer list comes from the catalogue the official API page itself uses:
`https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?…` (146 equirectangular layers).
Each record carries mission, instrument, native projection WKT, bounding box and creation date.

## 3. Licensing and attribution (as stated by the sources)

| Source | Statement found | Where |
| --- | --- | --- |
| NASA (Trek, mars.nasa.gov) | NASA content "generally [is] not subject to copyright in the United States"; "NASA should be acknowledged as the source of the material"; no implied endorsement | `https://www.nasa.gov/nasa-brand-center/images-and-media/` |
| USGS MOLA DEM | Access constraints: "CC0 (public domain)"; use constraints: none | Astropedia product page |
| USGS CTX DTM (Jezero) | Access constraints: none; use constraints: "Please cite authors"; DOI `10.5066/P906QQT8` | Astropedia product page |
| Mars 2020 raw images | Credit string per image, e.g. `NASA/JPL-Caltech/LANL/CNES/IRAP` (field `credit`) | API response |
| PDS (MEDA) | The product labels state no licence. PDS asks to cite data by DOI or LIDVID at the most granular level available; MARSWALK stores the LIDVID of every file | `https://pds.nasa.gov/datastandards/citing/` |

MARSWALK stores the credit and licence note with each dataset and shows the credit on the map.

## 4. Known limitations found during verification

1. **Trek scale denominators are not Mars values.** Level 0 states `2.79e8`, which corresponds to
   Earth's radius. Resolution must be computed from the tile grid (degrees per pixel) and the
   Mars radius, never from `ScaleDenominator`.
2. **Trek CRS label.** Layers declare `EPSG::104905`, which is Esri's "GCS Mars 2000" code, not an
   EPSG entry; the API config labels the same projection `IAU2000::104905`. USGS metadata for the
   underlying products says planetocentric latitude on the 3 396 190 m sphere. MARSWALK treats the
   tile grid as plain lon/lat degrees aligned with working SRID 949900 and keeps the declared
   label unchanged in provenance.
3. **Trek capabilities quirks.** One layer per capabilities document; `MatrixWidth` is written
   as `2.0`; the tile URL template contains `1.0.0//`.
4. **Trek tiles are pictures.** JPEG/PNG mosaics cannot be used for elevation, slope or
   temperature values. Numbers must come from the archived products (rows 2, 3, 6).
5. **Global MOLA GeoTIFF is not cloud-optimised.** The tag directory sits at byte 2 125 586 176,
   at the end of the 2.13 GB file. Regional reads need two range requests for metadata before
   any pixels.
6. **Host instability.** `atmos.nmsu.edu` reset the connection twice; the same archive answered on
   `pds-atmospheres.nmsu.edu`. Connectors must tolerate failures and retry.
7. **Layer names cannot be guessed.** A plausible THEMIS layer name returned 404; the real one
   differs. Names must come from the catalogue.
8. **MEDA is a point record.** It describes conditions at the rover, not a field over Jezero, and
   the archive lags the mission.

## 5. Recommended minimum set for the first working demonstration

| Step (5.2 order) | Dataset | Why | Status in MARSWALK |
| --- | --- | --- | --- |
| 1. Mars Trek | MOLA colour shaded relief (WMTS) | Verified live base map, global context | REAL |
| 2. MOLA | Jezero window of the global MOLA DEM (region read), plus **CTX DTM Jezero 20 m** (controlled to MOLA topography) as the working elevation grid | 9.7 MB covers the study area; 12.2 MB of the 2.13 GB global file is enough around it | REAL; slope/hazard rasters computed from it are DERIVED |
| 3. HiRISE/CTX | Trek CTX 6 m and HiRISE 25 cm orthomosaics (WMTS) | Detailed imagery without downloading gigabytes | REAL |
| 4. THEMIS | Trek THEMIS Day IR and Night IR 100 m mosaics | Thermal context layers | REAL (qualitative picture, not temperatures) |
| 5. Perseverance | Waypoints GeoJSON | Real surface positions and sols | REAL |
| 6. MEDA | `data_derived_env` (pressure, humidity, wind) and `data_calibrated_env` (air temperature), selected sols | Real measurements at the rover | REAL; any forecast built on it is SIMULATED |

Deferred: HiRISE 1 m DTM (1.84 GB, region reads only), rover traverse line, individual
HiRISE/CTX/THEMIS scenes from PDS, raw-image georeferencing, USGS SIM 3464 geologic map.

## 6. Not verified

- Observation date ranges of the instruments behind each mosaic (the services do not report them).
- Rate limits: none of the services documents one; none was hit during testing.
- Whether Trek tile latitude is planetocentric for every layer (taken from USGS product metadata).
- THEMIS brightness is not converted to temperature anywhere in MARSWALK.
- MEDA: only sol 100 was acquired and checked; other sols and other sensors (TIRS, RDS, SkyCam) are untested.

## 7. Integration results (Stage 5.4)

Connectors live in `backend/app/integrations/`, one module per source. `scripts/stage5-ingest.ps1`
runs them in the Stage 5.2 order. Every acquisition writes a provenance record to `datasets`
(source URL, retrieval time, SHA-256, native CRS, footprint, licence note, processing step);
files stay under `data/raw/`. Offline tests use small real samples in `backend/tests/fixtures/`;
`pytest -m live` repeats the checks against the services.

| Step | Connector | Dataset id | What is stored | Check against an independent source |
| --- | --- | --- | --- | --- |
| 1, 3, 4 | `trek.py` | `mgs_mola_shaded_relief_463m`, `mro_ctx_ortho_jezero_6m`, `mro_hirise_ortho_jezero_25cm`, `odyssey_themis_day_ir_100m`, `odyssey_themis_night_ir_100m` | Capabilities, catalogue record, tiles on demand (disk cache) | Tiles fetched and viewed: Jezero delta visible in CTX, HiRISE, THEMIS Day IR |
| 2 | `mola.py` | `mgs_mola_dem_463m` | 154×129 int16 cells, 77.0–78.203°E, 17.898–18.906°N, read with three `Range` requests (12.2 MB of 2.13 GB) | GDAL read of the same window: identical size, type, nodata and values (−2888…−566 m). Mean absolute difference to rover elevations 22 m |
| 3 | `ctx_dtm.py` | `mro_ctx_dtm_jezero_20m` | The USGS file unchanged (9 662 387 bytes) | 708 rover waypoints: mean difference −0.93 m, mean absolute 2.82 m, maximum 10.98 m; shifting the grid by cells makes it worse |
| 5 | `perseverance.py` | `m2020_rover_waypoints` | Raw GeoJSON + 708 rows in `scientific_targets` (sols 13–2022) | Straight line through the waypoints 39.8 km against NASA odometry 45.2 km (the driven path is longer, as expected) |
| 6 | `meda.py` | `m2020_meda_derived`, `m2020_meda_calibrated` | PDS4 labels + CSV tables of sol 100 (PS, RHS, WS, ATS) | Size and MD5 of every table equal the values in its label; pressure 753.6–771.1 Pa, air temperature 191–269 K |

`GET /api/v1/terrain/point` returns the value of the cell that contains the point: CTX DTM where it
reaches, MOLA around it. No interpolation.

Found while integrating:

1. **MOLA georeferencing.** The metre pixel scale in the file (463.0935 m) implies a radius of
   3 396 263 m while the keys declare 3 396 190 m. The grid is exact in degrees (128 px/deg), so
   the connector addresses it in degrees.
2. **Range requests.** A request with two byte ranges made the USGS server send the whole file.
   Connectors send single ranges and read the body only after the status is 206.
3. **Trek regional layers use the global tile grid.** Tiles outside the layer's bounding box are
   rejected locally and never requested. Deepest levels are 5.09 m (CTX), 0.32 m (HiRISE) and
   81 m (THEMIS) per pixel: resampled pictures, not the product resolution.
4. **Waypoints.** NASA marks 22 of 708 as interpolated; the file gives sols, not Earth dates, and
   uses −9999 for absent numbers.
5. **MEDA tables.** File names carry a version suffix (`P01`…`P03`) and must be taken from the
   directory listing. Records carry SCLK and local solar time; UTC exists only as the start and stop
   of each table. Some label field names differ from the CSV headers, the pressure label gives the
   uncertainty unit as kelvin, and the wind table uses an undeclared `999999999` for absent values.
   Per the bundle readme, humidity before sol 63 and wind before sol 36 are unreliable, and an empty
   cell means the value is not fit for science.
6. **MEDA host.** `pds-atmospheres.nmsu.edu` served about 20 KB/s (11 minutes for one sol), dropped
   connections, and its directory listings ignore `Range`. A verified local copy is reused.
