"""Stage 8: MARSWALK Hazard Detection & Risk Assessment Engine.

Combines real NASA/USGS datasets (CTX DTM 20 m slopes & relief discontinuities, 3x3 TRI
roughness, IAU/USGS Mars Planetary Nomenclature craters/valleys, and HiRISE/CRISM coverage
footprints) into an explainable, configurable risk model:
    R = w_slope * S + w_terrain * T + w_obstacle * O + w_uncertainty * U

Scientific honesty rules enforced here:
- Missing/NoData elevation is NEVER classified as safe (LOW); it yields class UNKNOWN with U = 1.0.
- Orbital imagery/20 m DTM cannot reliably resolve metre-scale boulders or ripples: uncertainty stays > 0.
- Steep slopes increase risk progressively rather than marking every slope automatically impassable.
- Preliminary research & planning aid only — not a certified astronaut safety system.
"""

from __future__ import annotations

import base64
import io
import math
import sys
import uuid
import xml.etree.ElementTree as ET
import zipfile
from array import array
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from geoalchemy2 import WKTElement
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.integrations import ctx_dtm, geotiff, terrain_analysis as ta
from app.integrations.http import fetch, shared_client, write_atomic
from app.models.geo import MARS_SRID, Dataset, HazardFeature
from app.repositories.datasets import upsert_real_dataset

NOMENCLATURE_URL = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.kmz"
NOMENCLATURE_SOURCE = "USGS / IAU Gazetteer of Planetary Nomenclature"
NOMENCLATURE_DATASET_ID = "usgs_iau_mars_nomenclature"
HAZARD_DISCLAIMER = (
    "Preliminary research and planning aid derived from 20 m CTX DTM and orbital metadata. "
    "Not a certified astronaut safety system; sub-20 m boulders and soft regolith require HiRISE 1 m DTM and in-situ verification."
)

# Official footprints of connected Jezero layers (degrees, planetocentric +E)
HIRISE_ORTHO_BBOX = (77.2229331, 18.3067994, 77.5839640, 18.6693150)
CRISM_BBOX = (77.2791950, 18.3646720, 77.5587930, 18.6350470)
STUDY_BBOX = (77.15, 18.20, 77.75, 18.75)

CLASS_CODE = {"UNKNOWN": 0, "LOW": 1, "MODERATE": 2, "HIGH": 3}


@dataclass(frozen=True)
class RiskConfig:
    w_slope: float = 0.40
    w_terrain: float = 0.25
    w_obstacle: float = 0.15
    w_uncertainty: float = 0.20
    slope_mod_deg: float = 10.0
    slope_high_deg: float = 18.0
    tri_high_m: float = 6.0
    relief_high_m: float = 18.0

    def validated(self) -> RiskConfig:
        total_w = self.w_slope + self.w_terrain + self.w_obstacle + self.w_uncertainty
        if total_w <= 0 or min(self.w_slope, self.w_terrain, self.w_obstacle, self.w_uncertainty) < 0:
            raise AppError(422, "INVALID_RISK_WEIGHTS", "Веса модели риска должны быть неотрицательными и не равными нулю.")
        if self.slope_mod_deg <= 0 or self.slope_high_deg <= self.slope_mod_deg:
            raise AppError(422, "INVALID_RISK_THRESHOLDS", "Порог высокого уклона должен превышать порог умеренного.")
        if self.tri_high_m <= 0 or self.relief_high_m <= 0:
            raise AppError(422, "INVALID_RISK_THRESHOLDS", "Пороги шероховатости и перепада должны быть положительными.")
        return self


def nomenclature_kmz_path() -> Path:
    return settings.data_dir / "raw" / "nomenclature" / "MARS_nomenclature_center_pts.kmz"


def parse_nomenclature_kmz(data: bytes, bbox: tuple[float, float, float, float] = STUDY_BBOX) -> list[dict[str, Any]]:
    """Extract IAU-adopted Mars features inside `bbox` from the official USGS KMZ."""
    west, south, east, north = bbox
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        kml_name = next(n for n in zf.namelist() if n.lower().endswith(".kml"))
        root = ET.fromstring(zf.read(kml_name))
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    features: list[dict[str, Any]] = []
    for pm in root.findall(".//k:Placemark", ns):
        coords = pm.findtext(".//k:coordinates", "", ns).strip()
        if not coords:
            continue
        lon, lat = map(float, coords.split(",")[:2])
        if not (west <= lon <= east and south <= lat <= north):
            continue
        sd = {d.attrib.get("name", ""): (d.text or "").strip() for d in pm.findall(".//k:SimpleData", ns)}
        name = pm.findtext("k:name", "", ns).strip() or sd.get("clean_name", "")
        diam = float(sd["diameter"]) if sd.get("diameter") else 0.0
        approval_raw = sd.get("approvaldt", "")
        obs_date = approval_raw.split(" ")[0].replace("/", "-") if approval_raw else "unknown"
        features.append({
            "name": name,
            "feature_type": sd.get("type", "Feature"),
            "lat": lat,
            "lon": lon,
            "diameter_km": diam,
            "approval_date": obs_date,
            "link": sd.get("link", ""),
            "bbox": [
                float(sd["min_lon"]) if sd.get("min_lon") else lon,
                float(sd["min_lat"]) if sd.get("min_lat") else lat,
                float(sd["max_lon"]) if sd.get("max_lon") else lon,
                float(sd["max_lat"]) if sd.get("max_lat") else lat,
            ],
        })
    return features


def acquire_nomenclature(client: httpx.Client) -> tuple[bytes, list[dict[str, Any]]]:
    resp = fetch(client, NOMENCLATURE_SOURCE, NOMENCLATURE_URL)
    data = resp.content
    feats = parse_nomenclature_kmz(data)
    write_atomic(nomenclature_kmz_path(), data)
    return data, feats


@lru_cache(maxsize=1)
def _all_nomenclature(mtime_ns: int) -> list[dict[str, Any]]:
    return parse_nomenclature_kmz(nomenclature_kmz_path().read_bytes(), (-180.0, -90.0, 180.0, 90.0))


def load_nomenclature(bbox: tuple[float, float, float, float] = STUDY_BBOX) -> list[dict[str, Any]]:
    """IAU features of the acquired gazetteer inside `bbox` (west, south, east, north); empty when it is not acquired."""
    path = nomenclature_kmz_path()
    if not path.exists():
        return []
    west, south, east, north = bbox
    return [f for f in _all_nomenclature(path.stat().st_mtime_ns) if west <= f["lon"] <= east and south <= f["lat"] <= north]


def _in_bbox(lon: float, lat: float, bbox: tuple[float, float, float, float]) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def _mars_dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_m = math.radians(0.5 * (lat1 + lat2))
    return math.hypot(
        math.radians(lon2 - lon1) * ta.MARS_RADIUS_M * math.cos(lat_m),
        math.radians(lat2 - lat1) * ta.MARS_RADIUS_M,
    )


def _clamp01(x: float) -> float:
    return 0.0 if x <= 0.0 else (1.0 if x >= 1.0 else x)


def _coverage_uncertainty(lon: float, lat: float, has_elev: bool, has_neighbors: bool) -> tuple[float, list[str], list[str]]:
    """Compute U in [0, 1] strictly from real dataset coverage (missing data -> U=1.0)."""
    if not has_elev or not has_neighbors:
        return 1.0, ["Missing DEM elevation or valid 3x3 neighborhood (NoData); never assumed safe."], ["Acquire overlapping DTM coverage before traversal."]
    in_hirise = _in_bbox(lon, lat, HIRISE_ORTHO_BBOX)
    in_crism = _in_bbox(lon, lat, CRISM_BBOX)
    u = 0.25  # baseline uncertainty because 1 m HiRISE DTM is not yet integrated (20 m CTX resolves >=20 m only)
    reasons: list[str] = []
    recs: list[str] = []
    if not in_hirise:
        u += 0.35
        reasons.append("Outside the loaded 25 cm HiRISE orthomosaic footprint (only coarser orbital imagery here).")
        recs.append("Inspect the best available orbital imagery and extend HiRISE coverage before EVA commitment.")
    else:
        recs.append("Verify sub-20 m boulders/ripples on 25 cm HiRISE imagery along the planned corridor.")
    if not in_crism:
        u += 0.10
        reasons.append("Outside CRISM FRT00005C5E mineralogy footprint.")
    return _clamp01(u), reasons, recs


def assess_cell(
    *,
    lat: float,
    lon: float,
    elev_m: float | None,
    slope_deg: float | None,
    tri_m: float | None,
    relief_m: float | None,
    craters: list[dict[str, Any]],
    cfg: RiskConfig,
    resolution_m: float = 20.0,
) -> dict[str, Any]:
    """Explainable Risk Assessment Engine for one terrain cell or coordinate."""
    cfg = cfg.validated()
    has_elev = elev_m is not None and math.isfinite(elev_m)
    has_nb = (
        slope_deg is not None and math.isfinite(slope_deg)
        and tri_m is not None and math.isfinite(tri_m)
        and relief_m is not None and math.isfinite(relief_m)
    )
    u, u_reasons, u_recs = _coverage_uncertainty(lon, lat, has_elev, has_nb)

    if not has_elev or not has_nb or u >= 0.85:
        return {
            "hazard_class": "UNKNOWN",
            "hazard_type": "data_gap",
            "risk_score": 1.0,
            "confidence": 0.0,
            "components": {"slope_risk": None, "terrain_risk": None, "obstacle_risk": None, "uncertainty": round(u, 3)},
            "reasons": u_reasons or ["Insufficient elevation/coverage metadata to assess surface safety."],
            "recommendations": u_recs,
        }

    assert slope_deg is not None and tri_m is not None and relief_m is not None
    k = ta.relief_scale(resolution_m)
    tri_n, relief_n = tri_m / k, relief_m / k  # compared with thresholds set on the 60 m grid
    s_risk = _clamp01(slope_deg / cfg.slope_high_deg)
    t_risk = _clamp01(0.5 * (tri_n / cfg.tri_high_m) + 0.5 * (relief_n / cfg.relief_high_m))

    # Obstacle risk from catalogued IAU craters (rim/wall zone) + local DEM concavity/scarp proxy.
    o_risk = 0.0
    nearest_crater: dict[str, Any] | None = None
    for cr in craters:
        if cr.get("feature_type", "").startswith("Crater") and 0.1 < cr.get("diameter_km", 0.0) <= 10.0:
            d_m = _mars_dist_m(lat, lon, cr["lat"], cr["lon"])
            rad_m = cr["diameter_km"] * 500.0
            if d_m <= rad_m * 1.4:
                prox = _clamp01(1.0 - abs(d_m - rad_m) / (0.6 * rad_m))
                if prox > o_risk:
                    o_risk = prox
                    nearest_crater = cr
    # Local abrupt scarp/eolian-trap proxy when relief jumps sharply relative to gentle cell slope
    scarp_proxy = _clamp01((relief_n - 12.0) / 18.0) * 0.5
    o_risk = max(o_risk, scarp_proxy)

    w_sum = cfg.w_slope + cfg.w_terrain + cfg.w_obstacle + cfg.w_uncertainty
    score = (cfg.w_slope * s_risk + cfg.w_terrain * t_risk + cfg.w_obstacle * o_risk + cfg.w_uncertainty * u) / w_sum

    if score >= 0.60 or (slope_deg >= cfg.slope_high_deg and score >= 0.45):
        h_class = "HIGH"
    elif score >= 0.30 or slope_deg >= cfg.slope_mod_deg:
        h_class = "MODERATE"
    else:
        h_class = "LOW"

    reasons: list[str] = []
    recs: list[str] = []
    if slope_deg >= cfg.slope_high_deg:
        h_type = "steep_slope"
        reasons.append(f"Steep slope {slope_deg:.1f}° exceeds high-risk threshold ({cfg.slope_high_deg:.0f}°); traversable only with steep-terrain protocol.")
        recs.append("Prefer Safest route mode or inspect HiRISE 25 cm imagery for talus/bedrock ledges.")
    elif relief_n >= cfg.relief_high_m:
        h_type = "elevation_discontinuity"
        reasons.append(f"Sharp local elevation drop/step of {relief_m:.1f} m in 3x3 DEM window.")
        recs.append("Check local scarp orientation in CTX/HiRISE imagery before crossing.")
    elif nearest_crater is not None and o_risk >= 0.45:
        h_type = "crater_wall"
        reasons.append(f"Near {nearest_crater['name']} crater ({nearest_crater['diameter_km']:.1f} km, IAU); rim ejecta and inner wall slopes.")
        recs.append("Keep stand-off from steep crater rim wall; check HiRISE boulders.")
    elif tri_n >= cfg.tri_high_m * 0.6:
        h_type = "rough_terrain"
        reasons.append(f"High surface roughness TRI = {tri_m:.1f} m across 3x3 cells.")
        recs.append("Assess rock-fall/roughness hazard on HiRISE 25 cm orthomosaic.")
    elif slope_deg >= cfg.slope_mod_deg:
        h_type = "moderate_slope"
        reasons.append(f"Moderate slope {slope_deg:.1f}° (above {cfg.slope_mod_deg:.0f}° caution threshold, not impassable).")
        recs.append("Account for slower Tobler suit speed and sideways slope penalty.")
    else:
        h_type = "nominal_terrain"
        reasons.append(f"Gentle slope ({slope_deg:.1f}°) and low TRI roughness ({tri_m:.1f} m) at the {resolution_m:g} m scale of the DEM.")

    reasons.extend(u_reasons)
    if resolution_m >= 100.0:
        reasons.append("Coarse 463 m MOLA resolution: insufficient for EVA obstacle detection.")
    recs.extend(u_recs)
    if not recs:
        recs.append("Cross-check HiRISE 25 cm imagery for sub-20 m rocks or wind-blown ripples.")

    confidence = round(_clamp01(1.0 - u), 2)
    return {
        "hazard_class": h_class,
        "hazard_type": h_type,
        "risk_score": round(score, 3),
        "confidence": confidence,
        "components": {
            "slope_risk": round(s_risk, 3),
            "terrain_risk": round(t_risk, 3),
            "obstacle_risk": round(o_risk, 3),
            "uncertainty": round(u, 3),
        },
        "reasons": reasons,
        "recommendations": list(dict.fromkeys(recs)),
    }


def _grid_arrays(west: float, south: float, east: float, north: float, step: int, cfg: RiskConfig) -> dict[str, Any]:
    cfg = cfg.validated()
    a = ta.analyze_window(west, south, east, north, step)
    k = ta.relief_scale(a["cell_m"][1])
    rows, cols = a["rows"], a["cols"]
    n = rows * cols
    elev = array("f")
    elev.frombytes(base64.b64decode(a["elevation_f32_b64"]))
    slope = array("f")
    slope.frombytes(base64.b64decode(a["slope_deg_f32_b64"]))
    rough = array("f")
    rough.frombytes(base64.b64decode(a["roughness_m_f32_b64"]))
    if sys.byteorder == "big":
        elev.byteswap()
        slope.byteswap()
        rough.byteswap()

    # 0.15 deg margin: a 10 km crater centred just outside the window still puts its rim inside it
    craters = load_nomenclature((a["west"] - 0.15, a["south"] - 0.15, a["east"] + 0.15, a["north"] + 0.15))
    small_craters = [c for c in craters if c.get("feature_type", "").startswith("Crater") and 0.1 < c.get("diameter_km", 0.0) <= 10.0]

    lat_span = a["north"] - a["south"]
    lon_span = a["east"] - a["west"]
    risk_u8 = bytearray(n)
    class_u8 = bytearray(n)
    unc_u8 = bytearray(n)
    counts = {"UNKNOWN": 0, "LOW": 0, "MODERATE": 0, "HIGH": 0}
    w_sum = cfg.w_slope + cfg.w_terrain + cfg.w_obstacle + cfg.w_uncertainty

    for r in range(rows):
        lat = a["north"] - (r + 0.5) / rows * lat_span
        row_off = r * cols
        for c in range(cols):
            i = row_off + c
            lon = a["west"] + (c + 0.5) / cols * lon_span
            e_v, sl_v, tr_v = elev[i], slope[i], rough[i]
            if not (math.isfinite(e_v) and math.isfinite(sl_v) and math.isfinite(tr_v)):
                class_u8[i] = 0
                risk_u8[i] = 255
                unc_u8[i] = 255
                counts["UNKNOWN"] += 1
                continue

            # 3x3 elevation discontinuity (relief_m)
            z_min = z_max = e_v
            for dr in (-1, 0, 1):
                rr = r + dr
                if not (0 <= rr < rows):
                    continue
                roff = rr * cols
                for dc in (-1, 0, 1):
                    cc = c + dc
                    if not (0 <= cc < cols):
                        continue
                    zv = elev[roff + cc]
                    if math.isfinite(zv):
                        if zv < z_min:
                            z_min = zv
                        if zv > z_max:
                            z_max = zv
            relief = (z_max - z_min) / k
            tr_v /= k

            in_hirise = _in_bbox(lon, lat, HIRISE_ORTHO_BBOX)
            in_crism = _in_bbox(lon, lat, CRISM_BBOX)
            u = 0.25 + (0.0 if in_hirise else 0.35) + (0.0 if in_crism else 0.10)
            s_risk = _clamp01(sl_v / cfg.slope_high_deg)
            t_risk = _clamp01(0.5 * (tr_v / cfg.tri_high_m) + 0.5 * (relief / cfg.relief_high_m))
            o_risk = _clamp01((relief - 12.0) / 18.0) * 0.5
            for cr in small_craters:
                d_m = _mars_dist_m(lat, lon, cr["lat"], cr["lon"])
                rad_m = cr["diameter_km"] * 500.0
                if d_m <= rad_m * 1.4:
                    o_risk = max(o_risk, _clamp01(1.0 - abs(d_m - rad_m) / (0.6 * rad_m)))

            score = (cfg.w_slope * s_risk + cfg.w_terrain * t_risk + cfg.w_obstacle * o_risk + cfg.w_uncertainty * u) / w_sum
            if score >= 0.60 or (sl_v >= cfg.slope_high_deg and score >= 0.45):
                cls = "HIGH"
            elif score >= 0.30 or sl_v >= cfg.slope_mod_deg:
                cls = "MODERATE"
            else:
                cls = "LOW"
            class_u8[i] = CLASS_CODE[cls]
            risk_u8[i] = max(0, min(255, round(score * 255)))
            unc_u8[i] = max(0, min(255, round(u * 255)))
            counts[cls] += 1

    return {
        "data_class": "DERIVED",
        "provenance_ids": sorted({*a["provenance_ids"], *( [NOMENCLATURE_DATASET_ID] if craters else [] )}),
        "west": a["west"],
        "south": a["south"],
        "east": a["east"],
        "north": a["north"],
        "rows": rows,
        "cols": cols,
        "cell_m": a["cell_m"],
        "weights": {"slope": cfg.w_slope, "terrain": cfg.w_terrain, "obstacle": cfg.w_obstacle, "uncertainty": cfg.w_uncertainty},
        "thresholds": {
            "slope_mod_deg": cfg.slope_mod_deg,
            "slope_high_deg": cfg.slope_high_deg,
            "tri_high_m": cfg.tri_high_m,
            "relief_high_m": cfg.relief_high_m,
        },
        "class_counts": counts,
        "risk_u8_b64": base64.b64encode(risk_u8).decode("ascii"),
        "class_u8_b64": base64.b64encode(class_u8).decode("ascii"),
        "uncertainty_u8_b64": base64.b64encode(unc_u8).decode("ascii"),
        "disclaimer": HAZARD_DISCLAIMER,
    }


def assess_point(lat: float, lon: float, cfg: RiskConfig) -> dict[str, Any]:
    pt = ta.point_analysis(lat, lon)
    craters = load_nomenclature((lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15))
    # Estimate 3x3 relief from TRI (~ sqrt(mean sq diff) -> max step roughly 2 * TRI on uniform slope, or read 3x3 window)
    relief_est = (pt["roughness_m"] or 0.0) * 2.2
    res = assess_cell(
        lat=lat,
        lon=lon,
        elev_m=pt["elevation_m"],
        slope_deg=pt["slope_deg"],
        tri_m=pt["roughness_m"],
        relief_m=relief_est,
        craters=craters,
        cfg=cfg,
        resolution_m=pt["resolution_m"],
    )
    sources = list(pt["provenance_ids"])
    dem = "MOLA" if pt["coarse_for_eva"] else "CTX"
    obs_dates = {} if pt["coarse_for_eva"] else {"mro_ctx_dtm_jezero_20m": "2020-07-24"}
    if _in_bbox(lon, lat, HIRISE_ORTHO_BBOX):
        sources.append("mro_hirise_ortho_jezero_25cm")
    if _in_bbox(lon, lat, CRISM_BBOX):
        sources.append("mro_crism_hyd_jezero")
        obs_dates["mro_crism_hyd_jezero"] = "2007-05-19"
    if craters:
        sources.append(NOMENCLATURE_DATASET_ID)
    return {
        "lat": lat,
        "lon": lon,
        "elevation_m": pt["elevation_m"],
        "slope_deg": pt["slope_deg"],
        "roughness_m": pt["roughness_m"],
        "data_class": "DERIVED",
        "sources": sources,
        "observation_dates": obs_dates,
        "detection_method": f"{dem} {int(pt['resolution_m'])} m central-difference slope + 3x3 TRI + coverage footprint check",
        "disclaimer": HAZARD_DISCLAIMER,
        **res,
    }


def ingest_nomenclature_and_hazards(db: Session, client: httpx.Client | None = None) -> list[HazardFeature]:
    """Download/parse USGS IAU Mars Nomenclature and populate real DERIVED/REAL hazard hotspots in PostGIS."""
    if client is not None or not nomenclature_kmz_path().exists():
        _, features = acquire_nomenclature(client or shared_client())
    else:
        features = parse_nomenclature_kmz(nomenclature_kmz_path().read_bytes())

    upsert_real_dataset(
        db,
        NOMENCLATURE_DATASET_ID,
        step={"step": "ingest_usgs_iau_nomenclature", "url": NOMENCLATURE_URL, "jezero_features": len(features)},
        metadata={"jezero_features": features},
        bbox=list(STUDY_BBOX),
        title="USGS / IAU Gazetteer of Planetary Nomenclature — Mars (Jezero study window)",
        mission_id=None,
        instrument_id=None,
        provider=NOMENCLATURE_SOURCE,
        product_id="MARS_nomenclature_center_pts",
        spatial_resolution_m=None,
        native_crs_wkt="Planetocentric Mars 2000 (+East)",
        source_archive="USGS Astrogeology Science Center",
        source_url=NOMENCLATURE_URL,
        raster_uri=nomenclature_kmz_path().relative_to(settings.data_dir.parent).as_posix(),
        license_note="Public domain (USGS / IAU WGPSN).",
        known_limitations="Center-point and bounding-box nomenclature only; crater rims require DTM slope verification.",
    )

    # Refresh only real/derived hazards, leaving the seeded is_demonstration=True row intact for legacy API checks.
    db.execute(delete(HazardFeature).where(HazardFeature.is_demonstration.is_(False)))

    cfg = RiskConfig()
    created: list[HazardFeature] = []

    def add_hazard(
        *,
        h_class: str,
        h_type: str,
        title: str,
        desc: str,
        dataset_id: str,
        lat: float,
        lon: float,
        obs_date: str,
        method: str,
        extra: dict[str, Any],
    ) -> None:
        assessed = assess_point(lat, lon, cfg) if ctx_dtm.product_path().exists() else {
            "risk_score": 0.5, "confidence": 0.65, "components": {}, "reasons": [desc], "recommendations": []
        }
        row = HazardFeature(
            id=uuid.uuid4(),
            dataset_id=dataset_id,
            hazard_class=h_class,
            title_ru=title,
            description_ru=desc,
            geom=WKTElement(f"POINT({lon} {lat})", srid=MARS_SRID),
            factors={
                "hazard_type": h_type,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "source_dataset": dataset_id,
                "observation_date": obs_date,
                "detection_method": method,
                "confidence": assessed["confidence"],
                "risk_score": assessed["risk_score"],
                "components": assessed["components"],
                "reasons": assessed["reasons"],
                "recommendations": assessed["recommendations"],
                "processing_info": "MARSWALK Stage 8 Risk Assessment Engine (CTX 20 m + IAU Nomenclature + coverage check)",
                "disclaimer": HAZARD_DISCLAIMER,
                **extra,
            },
            is_demonstration=False,
        )
        db.add(row)
        created.append(row)

    # 1. Real IAU/USGS geomorphological craters/valleys inside study window
    for f in features:
        if f["name"] in {"Belva", "Neretva Vallis", "Hartwell"}:
            h_type = "crater" if f["feature_type"].startswith("Crater") else "valley_scarp"
            h_class = "HIGH" if f["name"] == "Belva" else "MODERATE"
            add_hazard(
                h_class=h_class,
                h_type=h_type,
                title=f"{f['name']} ({f['feature_type'].split(',')[0]})",
                desc=f"IAU-adopted {f['feature_type'].lower()}, diameter {f['diameter_km']} km.",
                dataset_id=NOMENCLATURE_DATASET_ID,
                lat=f["lat"],
                lon=f["lon"],
                obs_date=f["approval_date"],
                method="IAU/USGS Planetary Nomenclature + CTX DTM slope cross-check",
                extra={"diameter_km": f["diameter_km"], "iau_link": f["link"]},
            )

    # 2. Extract top spatially separated CTX DTM hazards (steep slope, sharp elevation step, rough floor, and coverage-gap zone)
    if ctx_dtm.product_path().exists():
        g = ta.analyze_window(77.3, 18.3, 77.6, 18.55, 3)
        rows, cols = g["rows"], g["cols"]
        elev = array("f")
        elev.frombytes(base64.b64decode(g["elevation_f32_b64"]))
        slope = array("f")
        slope.frombytes(base64.b64decode(g["slope_deg_f32_b64"]))
        rough = array("f")
        rough.frombytes(base64.b64decode(g["roughness_m_f32_b64"]))
        if sys.byteorder == "big":
            elev.byteswap()
            slope.byteswap()
            rough.byteswap()
        lat_span = g["north"] - g["south"]
        lon_span = g["east"] - g["west"]

        candidates: list[tuple[float, str, str, float, float, float, float]] = []
        for r in range(2, rows - 2, 4):
            lat = g["north"] - (r + 0.5) / rows * lat_span
            for c in range(2, cols - 2, 4):
                i = r * cols + c
                sl, tr, ev = slope[i], rough[i], elev[i]
                if not (math.isfinite(sl) and math.isfinite(tr) and math.isfinite(ev)):
                    continue
                if sl >= 18.0:
                    candidates.append((sl, "HIGH", "steep_slope", lat, g["west"] + (c + 0.5) / cols * lon_span, sl, tr))
                elif tr >= 8.0:
                    candidates.append((tr, "HIGH" if sl >= 12.0 else "MODERATE", "rough_terrain", lat, g["west"] + (c + 0.5) / cols * lon_span, sl, tr))

        picked: list[tuple[float, float]] = []
        candidates.sort(reverse=True)
        for _, hc, ht, lat, lon, sl, tr in candidates:
            if any(_mars_dist_m(lat, lon, plat, plon) < 2200.0 for plat, plon in picked):
                continue
            picked.append((lat, lon))
            add_hazard(
                h_class=hc,
                h_type=ht,
                title=("Steep scarp" if ht == "steep_slope" else "Rough terrain cluster") + f" ({lat:.3f}°N, {lon:.3f}°E)",
                desc=f"CTX DTM derived slope {sl:.1f}°, 3x3 TRI roughness {tr:.1f} m.",
                dataset_id=ctx_dtm.DATASET_ID,
                lat=lat,
                lon=lon,
                obs_date="2020-07-24",
                method="Automated CTX 20 m DTM slope & TRI peak extraction",
                extra={"peak_slope_deg": round(sl, 1), "peak_tri_m": round(tr, 1)},
            )
            if len(picked) >= 6:
                break

        # 3. Explicit low-coverage / higher-uncertainty zone (East of HiRISE 25 cm mosaic boundary 77.584°E)
        add_hazard(
            h_class="UNKNOWN",
            h_type="coverage_gap",
            title="Low-resolution coverage zone (East Jezero)",
            desc="Outside 25 cm HiRISE orthomosaic & CRISM swath; only 20 m CTX DTM and 6 m imagery available.",
            dataset_id=ctx_dtm.DATASET_ID,
            lat=18.45,
            lon=77.595,
            obs_date="2020-07-24",
            method="Dataset footprint coverage & uncertainty check (no HiRISE 25 cm / 1 m DTM)",
            extra={"coverage_note": "Never assume unmapped or coarse terrain is obstacle-free."},
        )

    db.flush()
    return created


if __name__ == "__main__":  # python -m app.integrations.hazard_detection
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        rows = ingest_nomenclature_and_hazards(session, shared_client())
        session.commit()
        print(f"ingested {len(rows)} hazard features")
