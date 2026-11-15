from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def test_health_endpoint_responds_and_hides_secrets() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    payload = response.json()

    assert payload["service"] == "MARSWALK API"
    assert payload["status"] in {"ok", "degraded"}
    assert payload["data_dir_ready"] is True
    assert "не сертифицирован nasa" in payload["disclaimer_ru"].lower()
    assert "X-Request-ID" in response.headers

    raw_body = response.text
    assert settings.postgres_password.get_secret_value() not in raw_body
    if settings.gemini_api_key is not None:
        secret_key = settings.gemini_api_key.get_secret_value().strip()
        if secret_key:
            assert secret_key not in raw_body


def test_root_health_alias_and_swagger_docs() -> None:
    health_res = client.get("/health")
    assert health_res.status_code == 200

    docs_res = client.get("/docs")
    assert docs_res.status_code == 200
    assert "Swagger UI" in docs_res.text


def test_database_connectivity() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    db_info = response.json()["database"]
    assert db_info["connected"] is True, f"Expected PostgreSQL connection, got: {db_info}"
    assert db_info["server_version"] is not None
