from fastapi import APIRouter

from app.core.config import settings
from app.core.database import check_database_health
from app.schemas.health import DatabaseStatusSchema, HealthResponseSchema

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponseSchema,
    summary="Проверка состояния API, PostgreSQL/PostGIS и хранилища данных",
)
def get_health() -> HealthResponseSchema:
    db = check_database_health()
    data_ready = settings.data_dir.exists() and settings.data_dir.is_dir()
    overall = "ok" if (db.connected and data_ready) else "degraded"
    return HealthResponseSchema(
        status=overall,
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        database=DatabaseStatusSchema(
            connected=db.connected,
            server_version=db.server_version,
            postgis_installed=db.postgis_installed,
            postgis_version=db.postgis_version,
            error=db.error,
        ),
        data_dir_ready=data_ready,
        gemini_configured=settings.gemini_configured,
    )
