"""Unit and API tests for Stage 8 Hazard Detection & Risk Assessment Engine."""

import base64
import io
import shutil
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.errors import AppError
from app.integrations import ctx_dtm, hazard_detection as hd

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def ctx_acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


def test_missing_data_is_unknown_never_safe() -> None:
    res = hd.assess_cell(
        lat=18.44,
        lon=77.45,
        elev_m=None,
        slope_deg=None,
        tri_m=None,
        relief_m=None,
        craters=[],
        cfg=hd.RiskConfig(),
    )
    assert res["hazard_class"] == "UNKNOWN"
    assert res["components"]["uncertainty"] == 1.0
    assert res["confidence"] == 0.0


def test_moderate_slope_is_not_automatically_high_and_weights_change_score() -> None:
    crater = [{"name": "Belva", "feature_type": "Crater, craters", "lat": 18.48, "lon": 77.38, "diameter_km": 0.9}]
    base = hd.assess_cell(
        lat=18.45,
        lon=77.45,
        elev_m=-2550.0,
        slope_deg=11.0,
        tri_m=1.2,
        relief_m=3.0,
        craters=crater,
        cfg=hd.RiskConfig(),
    )
    assert base["hazard_class"] == "MODERATE"
    assert base["components"]["slope_risk"] == pytest.approx(11.0 / 18.0, abs=1e-3)

    slope_heavy = hd.assess_cell(
        lat=18.45,
        lon=77.45,
        elev_m=-2550.0,
        slope_deg=11.0,
        tri_m=1.2,
        relief_m=3.0,
        craters=crater,
        cfg=hd.RiskConfig(w_slope=0.9, w_terrain=0.05, w_obstacle=0.0, w_uncertainty=0.05, slope_high_deg=15.0),
    )
    assert slope_heavy["risk_score"] > base["risk_score"]
    assert slope_heavy["hazard_class"] == "HIGH"


def test_outside_hirise_coverage_increases_uncertainty() -> None:
    inside = hd.assess_cell(
        lat=18.45, lon=77.45, elev_m=-2550.0, slope_deg=2.0, tri_m=0.5, relief_m=1.0, craters=[], cfg=hd.RiskConfig()
    )
    outside = hd.assess_cell(
        lat=18.45, lon=77.62, elev_m=-2550.0, slope_deg=2.0, tri_m=0.5, relief_m=1.0, craters=[], cfg=hd.RiskConfig()
    )
    assert outside["components"]["uncertainty"] > inside["components"]["uncertainty"]
    assert outside["confidence"] < inside["confidence"]


def test_invalid_risk_weights_rejected() -> None:
    with pytest.raises(AppError) as err:
        hd.RiskConfig(w_slope=0.0, w_terrain=0.0, w_obstacle=0.0, w_uncertainty=0.0).validated()
    assert err.value.code == "INVALID_RISK_WEIGHTS"


def test_parses_iau_nomenclature_kmz() -> None:
    kml = """<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
      <name>Belva</name>
      <ExtendedData><SchemaData>
        <SimpleData name="type">Crater, craters</SimpleData>
        <SimpleData name="diameter">0.9</SimpleData>
        <SimpleData name="approvaldt">2020/01/17 00:00:00</SimpleData>
      </SchemaData></ExtendedData>
      <Point><coordinates>77.38,18.48,0</coordinates></Point>
    </Placemark></Document></kml>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("doc.kml", kml)
    feats = hd.parse_nomenclature_kmz(buf.getvalue())
    assert len(feats) == 1
    assert (feats[0]["name"], feats[0]["diameter_km"], feats[0]["approval_date"]) == ("Belva", 0.9, "2020-01-17")


def test_hazard_endpoints_return_explainable_assessment_and_grid(client: TestClient, ctx_acquired) -> None:
    list_res = client.get("/api/v1/hazards", params={"include_demo": False, "limit": 20})
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert len(items) >= 3
    sample = items[0]
    assert sample["hazard_class"] in {"LOW", "MODERATE", "HIGH", "UNKNOWN"}
    assert sample["geometry"] and "coordinates" in sample["geometry"]
    for key in ("hazard_type", "source_dataset", "confidence", "detection_method", "observation_date", "processing_info", "disclaimer"):
        assert key in sample["factors"]

    grid_res = client.get(
        "/api/v1/hazards/grid",
        params={"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530, "step": 2},
    )
    assert grid_res.status_code == 200
    grid = grid_res.json()
    assert grid["data_class"] == "DERIVED"
    assert len(base64.b64decode(grid["class_u8_b64"])) == grid["rows"] * grid["cols"]
    assert sum(grid["class_counts"].values()) == grid["rows"] * grid["cols"]

    pt_res = client.get("/api/v1/hazards/assess", params={"lat": 18.4447, "lon": 77.4508})
    assert pt_res.status_code == 200
    pt = pt_res.json()
    assert pt["hazard_class"] in {"LOW", "MODERATE", "HIGH", "UNKNOWN"}
    assert "not a certified astronaut safety system" in pt["disclaimer"].lower()
    assert len(pt["reasons"]) >= 1 and len(pt["recommendations"]) >= 1
