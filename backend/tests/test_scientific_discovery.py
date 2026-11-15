"""Unit and API tests for Stage 10 Scientific Discovery module and route waypoint integration."""

import shutil
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.integrations import ctx_dtm, scientific_discovery as sd

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def ctx_acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


def test_curated_targets_respect_scientific_honesty_and_evidence_levels() -> None:
    levels = {t["evidence_level"] for t in sd.CURATED_TARGETS}
    assert {"direct_observation", "scientific_interpretation", "candidate_target", "hypothesis"} <= levels
    for t in sd.CURATED_TARGETS:
        text = (t["description"] + " " + t["source_citation"]).lower()
        assert "proof of life" not in text and "biosignatures confirmed" not in text
        assert 0.0 < t["confidence"] <= 1.0
        assert t["instrument"] and t["source_citation"]


def test_ingest_with_mocked_nasa_raw_images_and_filter_api(client: TestClient) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "images": [
                    {
                        "imageid": "ZL0_TEST",
                        "date_taken_utc": "2023-05-05T10:04:43.919Z",
                        "credit": "NASA/JPL-Caltech/ASU",
                        "camera": {"instrument": "MCZ_LEFT"},
                        "image_files": {"medium": "https://mars.nasa.gov/test/mcz.jpg"},
                    }
                ]
            },
        )

    with SessionLocal() as db:
        rows = sd.ingest(db, httpx.Client(transport=httpx.MockTransport(handler)))
        assert len(rows) == len(sd.CURATED_TARGETS)
        assert all(r.is_demonstration is False for r in rows)
        db.rollback()

    res = client.get("/api/v1/targets", params={"include_demo": False, "evidence_level": "candidate_target"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "sci_crism_clays_fan"
    assert items[0]["geometry"]["type"] == "Point"
    assert items[0]["instrument"].startswith("MRO CRISM")

    near = client.get(
        "/api/v1/targets",
        params={"include_demo": False, "category": "carbonate_deposits", "lat": 18.48344, "lon": 77.35078, "radius_m": 500},
    )
    assert near.status_code == 200
    assert [x["id"] for x in near.json()["items"]] == ["sci_margin_carbonates"]


def test_route_plan_visits_selected_science_waypoint(client: TestClient, ctx_acquired) -> None:
    # Two cells inside the 64x64 landing fixture + an intermediate science waypoint between them
    res = client.post(
        "/api/v1/routes/plan",
        json={
            "start": {"lat": 18.440, "lon": 77.446},
            "destination": {"lat": 18.450, "lon": 77.456},
            "waypoints": [{"lat": 18.4446, "lon": 77.4509}],
            "modes": ["SHORTEST"],
            "west": 77.4420,
            "south": 18.4360,
            "east": 77.4600,
            "north": 18.4530,
            "step": 1,
        },
    )
    assert res.status_code == 200
    alt = res.json()["alternatives"][0]
    assert alt["status"] == "found"
    assert any("selected scientific waypoint" in c for c in alt["constraints"])
