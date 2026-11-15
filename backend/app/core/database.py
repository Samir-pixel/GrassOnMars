import logging
from collections.abc import Generator
from dataclasses import dataclass

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger("marswalk.db")


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 3},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@dataclass(frozen=True)
class DatabaseHealth:
    connected: bool
    server_version: str | None
    postgis_installed: bool
    postgis_version: str | None
    error: str | None = None


def check_database_health() -> DatabaseHealth:
    try:
        with engine.connect() as conn:
            server_version = conn.execute(text("SHOW server_version")).scalar_one()
            ext_installed = bool(
                conn.execute(
                    text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')")
                ).scalar_one()
            )
            postgis_version: str | None = None
            if ext_installed:
                postgis_version = conn.execute(text("SELECT PostGIS_Version()")).scalar_one()
            return DatabaseHealth(
                connected=True,
                server_version=str(server_version),
                postgis_installed=ext_installed,
                postgis_version=str(postgis_version) if postgis_version else None,
            )
    except Exception as exc:
        logger.warning("Database health check failed: %s", exc.__class__.__name__)
        return DatabaseHealth(
            connected=False,
            server_version=None,
            postgis_installed=False,
            postgis_version=None,
            error=exc.__class__.__name__,
        )
