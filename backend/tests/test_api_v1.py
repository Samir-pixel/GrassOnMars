from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.database import engine


def test_missions_list(client: TestClient) -> None:
    response = client.get("/api/v1/missions")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 4
    assert {m["id"] for m in payload["items"]} >= {"mgs", "mro", "mars2020", "odyssey"}
    mgs = next(m for m in payload["items"] if m["id"] == "mgs")
    assert "MOLA" in mgs["instruments"]


def test_datasets_provenance_and_raster_uri(client: TestClient) -> None:
    response = client.get("/api/v1/datasets", params={"mission_id": "mro", "limit": 20})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert all(item["mission_id"] == "mro" for item in payload["items"])
    ctx = next(i for i in payload["items"] if i["id"] == "mro_ctx_dtm_jezero_20m")
    assert ctx["raster_uri"].endswith(".tif")
    assert ctx["working_srid"] == 949900
    assert ctx["observed_at_start"] is None


def test_layers_list(client: TestClient) -> None:
    response = client.get("/api/v1/layers")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 3
    assert any(layer["id"] == "mola_shaded_relief" for layer in payload["items"])


def test_targets_demo_and_radius_search(client: TestClient) -> None:
    all_targets = client.get("/api/v1/targets")
    assert all_targets.status_code == 200
    assert all_targets.json()["total"] >= 3
    # Real rover waypoints share this table once ingested; only "demo_" rows are demonstration data.
    demo = [t for t in all_targets.json()["items"] if t["id"].startswith("demo_")]
    assert len(demo) >= 3 and all(t["is_demonstration"] for t in demo)

    near_landing = client.get(
        "/api/v1/targets",
        params={"lat": 18.4447, "lon": 77.4508, "radius_m": 500},
    )
    assert near_landing.status_code == 200
    ids = {t["id"] for t in near_landing.json()["items"]}
    assert "demo_octavia_e_butler_landing" in ids
    assert "demo_western_delta_outcrop" not in ids


def test_targets_bbox_search(client: TestClient) -> None:
    response = client.get(
        "/api/v1/targets",
        params={
            "min_lon": 77.47,
            "min_lat": 18.49,
            "max_lon": 77.49,
            "max_lat": 18.51,
        },
    )
    assert response.status_code == 200
    ids = {t["id"] for t in response.json()["items"]}
    assert "demo_western_delta_outcrop" in ids
    assert "demo_octavia_e_butler_landing" not in ids


def test_hazards_spatial(client: TestClient) -> None:
    response = client.get(
        "/api/v1/hazards",
        params={"lat": 18.47, "lon": 77.46, "radius_m": 2000},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert payload["items"][0]["is_demonstration"] is True
    assert payload["items"][0]["hazard_class"] == "no_go"


def test_validation_rejects_bad_coordinates(client: TestClient) -> None:
    response = client.get("/api/v1/terrain/slope", params={"lat": 120, "lon": 77.5})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"


def test_terrain_slope_and_profile_validate_coords(client: TestClient) -> None:
    assert client.get("/api/v1/terrain/slope", params={"lat": 120, "lon": 77.5}).status_code == 422
    assert client.get(
        "/api/v1/terrain/profile",
        params={"start_lat": 95, "start_lon": 77.45, "end_lat": 18.5, "end_lon": 77.5},
    ).status_code == 422


def test_environment_summary_from_ingested_meda(client: TestClient) -> None:
    res = client.get("/api/v1/environment", params={"sol": 100})
    assert res.status_code == 200
    body = res.json()
    assert body["sol"] == 100
    assert body["data_class"] == "DERIVED"
    assert set(body["provenance_ids"]) >= {"m2020_meda_derived", "m2020_meda_calibrated"}
    assert -90 < body["air_temp_min_c"] < body["air_temp_max_c"] < 10
    assert 700 < body["pressure_min_pa"] < body["pressure_max_pa"] < 850
    assert client.get("/api/v1/environment", params={"sol": 9999}).status_code == 404


def test_route_simulation_report_persistence(client: TestClient) -> None:
    route_res = client.post(
        "/api/v1/routes",
        json={
            "points": [
                {"lat": 18.4447, "lon": 77.4508},
                {"lat": 18.5, "lon": 77.5},
            ]
        },
    )
    assert route_res.status_code == 201
    route = route_res.json()
    assert route["status"] == "not_integrated"
    assert route["points"][0]["lat"] == 18.4447

    missing = client.post(
        "/api/v1/simulations",
        json={"route_id": str(uuid4()), "assumptions": {}},
    )
    assert missing.status_code == 404

    sim_res = client.post(
        "/api/v1/simulations",
        json={"route_id": route["id"], "assumptions": {"walk_speed_mps": 0.3}},
    )
    assert sim_res.status_code == 201

    report_res = client.post(
        "/api/v1/reports",
        json={"route_id": route["id"], "meda_reference_sol": 100},
    )
    assert report_res.status_code == 201


def test_route_rejects_single_point(client: TestClient) -> None:
    response = client.post(
        "/api/v1/routes",
        json={"points": [{"lat": 18.4, "lon": 77.5}]},
    )
    assert response.status_code == 422


def test_postgis_and_mars_srids_registered() -> None:
    with engine.connect() as conn:
        postgis = conn.execute(text("SELECT PostGIS_Version()")).scalar_one()
        assert postgis
        srid = conn.execute(
            text("SELECT COUNT(*) FROM spatial_ref_sys WHERE srid IN (949900, 949918)")
        ).scalar_one()
        assert srid == 2


def test_fk_route_segment_and_demo_lineage() -> None:
    with engine.connect() as conn:
        segs = conn.execute(text("SELECT COUNT(*) FROM route_segments")).scalar_one()
        assert segs >= 1
        demo = conn.execute(
            text(
                "SELECT COUNT(*) FROM scientific_targets "
                "WHERE is_demonstration AND source_identifier = 'DEMONSTRATION DATA'"
            )
        ).scalar_one()
        assert demo >= 3
