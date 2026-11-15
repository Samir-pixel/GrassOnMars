from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def apply_migrations() -> Generator[None, None, None]:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch) -> None:
    """Tests never read or write the real data/ directory and never sleep between retries."""
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr("app.integrations.http.time.sleep", lambda s: None)


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db_conn():
    with engine.connect() as conn:
        yield conn
        conn.execute(text("SELECT 1"))
