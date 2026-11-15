"""Stage 12: every assistant tool on the CTX fixture, intent detection, and the Gemini tool loop with a mocked model."""

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import AppError
from app.integrations import assistant as ai, ctx_dtm, gemini, meda

FIXTURES = Path(__file__).parent / "fixtures"
WINDOW = {"west": 77.4420, "south": 18.4360, "east": 77.4600, "north": 18.4530, "step": 1}
PAIR = {"start_lat": 18.440, "start_lon": 77.446, "dest_lat": 18.450, "dest_lon": 77.456}


@pytest.fixture()
def ctx_acquired() -> None:
    path = ctx_dtm.product_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "ctx_dtm_landing_64px.tif", path)


@pytest.fixture()
def db():
    with SessionLocal() as session:
        yield session
        session.rollback()


@pytest.fixture()
def no_meda(monkeypatch) -> None:
    def missing(db, sol=None):
        raise AppError(503, "DATASET_NOT_ACQUIRED", "Данные MEDA ещё не загружены.")

    monkeypatch.setattr(meda, "sol_summary", missing)


def test_declarations_cover_all_nine_tools_with_flat_schemas() -> None:
    decl = ai.declarations()
    assert [d["name"] for d in decl] == [
        "get_available_layers", "get_dataset_metadata", "get_terrain_profile", "get_hazards", "calculate_route",
        "search_scientific_targets", "get_environmental_observations", "compare_routes", "generate_mission_report",
    ]
    assert all("$ref" not in json.dumps(d["parametersJsonSchema"]) for d in decl)


def test_get_available_layers(db) -> None:
    r = ai.execute(db, "get_available_layers", {})
    assert r["ok"] and r["layers"]
    assert set(r["sources"]) == {x["dataset_id"] for x in r["layers"]}


def test_get_dataset_metadata_real_and_unknown(db) -> None:
    r = ai.execute(db, "get_dataset_metadata", {"dataset_id": "mro_ctx_dtm_jezero_20m"})
    assert r["ok"] and r["sources"] == ["mro_ctx_dtm_jezero_20m"]
    assert r["datasets"][0]["data_class"] == "REAL"
    missing = ai.execute(db, "get_dataset_metadata", {"dataset_id": "made_up_dataset"})
    assert missing == {**missing, "ok": False, "error": "DATASET_NOT_FOUND"}


def test_get_terrain_profile(db, ctx_acquired) -> None:
    r = ai.execute(db, "get_terrain_profile", {"start_lat": 18.440, "start_lon": 77.446, "end_lat": 18.450, "end_lon": 77.456})
    assert r["ok"] and r["data_class"] == "DERIVED"
    assert r["min_elevation_m"] <= r["max_elevation_m"] and 800 < r["straight_line_distance_m"] < 830
    assert "mro_ctx_dtm_jezero_20m" in r["sources"]


def test_get_hazards_point_coverage_and_features(db, ctx_acquired) -> None:
    pt = ai.execute(db, "get_hazards", {"mode": "point", "lat": 18.4447, "lon": 77.4508})
    assert pt["ok"] and pt["reasons"] and pt["hazard_class"] in {"LOW", "MODERATE", "HIGH", "UNKNOWN"}
    assert ai.execute(db, "get_hazards", {"mode": "point"})["error"] == "COORDINATES_REQUIRED"
    cov = ai.execute(db, "get_hazards", {"mode": "coverage", **WINDOW})
    assert cov["ok"] and 0 <= cov["share_without_terrain_data"] <= 1
    assert sum(cov["class_counts"].values()) > 0
    feats = ai.execute(db, "get_hazards", {"mode": "features", "lat": 18.44, "lon": 77.45, "radius_m": 20_000})
    assert feats["ok"] and all(h["hazard_class"] for h in feats["hazards"])


def test_calculate_route_never_claims_guaranteed_safety(db, ctx_acquired) -> None:
    r = ai.execute(db, "calculate_route", {**PAIR, **WINDOW})
    assert r["ok"] and r["data_class"] == "DERIVED"
    assert r["lowest_modelled_risk_mode"] in {"SHORTEST", "LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY"}
    assert ai.NO_GUARANTEE in r["uncertainty"]
    assert {a["mode"] for a in r["alternatives"]} == {"SHORTEST", "LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY"}
    outside = ai.execute(db, "calculate_route", {**PAIR, "dest_lat": 10.0, **WINDOW})
    assert outside["ok"] is False and outside["error"] == "OUTSIDE_COVERAGE"


def test_compare_routes_gives_pairwise_differences(db, ctx_acquired) -> None:
    r = ai.execute(db, "compare_routes", {**PAIR, **WINDOW, "modes": ["SHORTEST", "LOWEST_TERRAIN_RISK"]})
    assert r["ok"] and len(r["comparison"]) == 1
    c = r["comparison"][0]
    a, b = r["alternatives"]
    assert c["total_distance_m_b_minus_a"] == round(b["total_distance_m"] - a["total_distance_m"], 2)


def test_search_scientific_targets_within_500_m(db) -> None:
    r = ai.execute(db, "search_scientific_targets", {"lat": 18.48344, "lon": 77.35078, "radius_m": 500})
    assert r["ok"]
    assert all(t["distance_m"] <= 500 for t in r["targets"])
    assert r["targets"] == sorted(r["targets"], key=lambda t: t["distance_m"])


def test_environmental_observations_are_historical_or_reported_missing(db, monkeypatch, no_meda) -> None:
    gone = ai.execute(db, "get_environmental_observations", {})
    assert gone["ok"] is False and gone["error"] == "DATASET_NOT_ACQUIRED"

    def summary(db, sol=None):
        return {
            "sol": 100, "available_sols": [100], "provenance_ids": ["m2020_meda_sol100"],
            "observed_at_start": "2021-05-28T00:00:00", "observed_at_end": "2021-05-29T00:00:00",
            "air_temp_min_c": -80.0, "records": {"CAL_ATS": 10},
        }

    monkeypatch.setattr(meda, "sol_summary", summary)
    ok = ai.execute(db, "get_environmental_observations", {"sol": 100})
    assert ok["ok"] and ok["historical"] is True
    assert "not current conditions" in ok["uncertainty"][0]


def test_generate_mission_report_lists_what_is_missing(db, ctx_acquired, no_meda) -> None:
    r = ai.execute(db, "generate_mission_report", {**PAIR, **WINDOW})
    assert r["ok"] and r["read_only"] is True
    assert {"routes", "destination_hazard", "science_near_destination"} <= set(r["report"])
    assert any(m.startswith("environment: DATASET_NOT_ACQUIRED") for m in r["missing"])
    assert ai.NO_GUARANTEE in r["uncertainty"]


def test_invalid_and_unknown_tool_calls_are_errors_not_guesses(db) -> None:
    assert ai.execute(db, "get_terrain_profile", {"start_lat": 999})["error"] == "INVALID_ARGUMENTS"
    assert ai.execute(db, "drop_table", {})["error"] == "UNKNOWN_TOOL"


@pytest.mark.parametrize(
    ("question", "tool"),
    [
        ("Find the lowest-risk route to the selected target", "calculate_route"),
        ("Show scientific targets within 500 meters", "search_scientific_targets"),
        ("Compare the elevation profiles of two routes", "compare_routes"),
        ("Explain why this terrain segment has a high risk score", "get_hazards"),
        ("Show all datasets available for this region", "get_dataset_metadata"),
        ("Identify areas with insufficient terrain coverage", "get_hazards"),
    ],
)
def test_classify_intent_on_spec_examples(question, tool) -> None:
    assert tool in ai.classify_intent(question)


def test_default_arguments_plan_in_the_region_open_on_the_map() -> None:
    region = {"west": 136.9, "south": -5.1, "east": 137.9, "north": -4.1, "step": 1}
    ctx = {"start": {"lat": -4.59, "lon": 137.44}, "target": {"lat": -4.7, "lon": 137.5}, "region": region}
    route = ai.default_arguments("calculate_route", "route", ctx)
    assert {k: route[k] for k in region} == region and route["start_lat"] == -4.59
    assert ai.RouteArgs(**route).step == 1  # the merged arguments are what the tool accepts
    assert ai.default_arguments("get_hazards", "insufficient coverage", ctx) == {"mode": "coverage", **region}
    assert set(ai.default_arguments("get_terrain_profile", "profile", ctx)) == {"start_lat", "start_lon", "end_lat", "end_lon"}
    assert ai.default_arguments("calculate_route", "route", {"region": region}) == {}  # no selection: nothing is guessed


def test_chat_runs_the_tool_the_model_asks_for(client: TestClient, monkeypatch, ctx_acquired) -> None:
    sent: list[list] = []
    replies = iter(
        [
            {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": "calculate_route", "args": {**PAIR, **WINDOW}}}]}}]},
            {"candidates": [{"content": {"role": "model", "parts": [{"text": "LOWEST_TERRAIN_RISK has the lowest modelled risk."}]}}]},
        ]
    )

    def fake_generate(contents, system, tools=None, max_tokens=512):
        sent.append(json.loads(json.dumps(contents)))
        assert "Never invent scientific measurements" in system and len(tools) == 9
        return next(replies)

    monkeypatch.setattr(gemini, "generate", fake_generate)
    res = client.post(
        "/api/v1/assistant/chat",
        json={"messages": [{"role": "user", "text": "Hi"}, {"role": "assistant", "text": "Hello"}, {"role": "user", "text": "Safest route?"}]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "gemini" and body["text"].startswith("LOWEST_TERRAIN_RISK")
    assert body["tool_calls"] == [{"name": "calculate_route", "arguments": {**PAIR, **WINDOW}, "ok": True, "error": None}]
    assert "mro_ctx_dtm_jezero_20m" in body["sources"]
    assert ai.NO_GUARANTEE in body["uncertainty"]
    assert [c["role"] for c in sent[0]] == ["user", "model", "user"]
    assert "functionResponse" in sent[1][-1]["parts"][0]


def test_chat_without_gemini_falls_back_to_detected_tools(client: TestClient, monkeypatch, ctx_acquired) -> None:
    monkeypatch.setattr(settings, "gemini_api_key", None)
    res = client.post(
        "/api/v1/assistant/chat",
        json={
            "messages": [{"role": "user", "text": "Find the lowest-risk route to the selected target"}],
            "context": {"start": {"lat": 18.440, "lon": 77.446}, "target": {"lat": 18.4447, "lon": 77.4509}},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "deterministic"
    assert body["tool_calls"][0]["name"] == "calculate_route"
    # default Jezero window at step 3: the fixture covers part of it, so either a plan or an explicit coverage error
    assert body["tool_calls"][0]["ok"] or body["tool_calls"][0]["error"] in {"OUTSIDE_COVERAGE", "SAME_CELL"}


def test_chat_rejects_assistant_as_last_message(client: TestClient) -> None:
    res = client.post("/api/v1/assistant/chat", json={"messages": [{"role": "assistant", "text": "x"}]})
    assert res.status_code == 422
    big = client.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "text": "x"}], "context": {"page": {"s": "x" * 40_000}}})
    assert big.status_code == 422
