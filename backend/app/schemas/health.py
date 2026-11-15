from datetime import datetime, timezone

from pydantic import BaseModel, Field


class DatabaseStatusSchema(BaseModel):
    connected: bool
    server_version: str | None = None
    postgis_installed: bool = False
    postgis_version: str | None = None
    error: str | None = None


class HealthResponseSchema(BaseModel):
    status: str = Field(description="ok или degraded")
    service: str
    version: str
    environment: str
    timestamp_utc: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    database: DatabaseStatusSchema
    data_dir_ready: bool
    gemini_configured: bool
    disclaimer_ru: str = (
        "Исследовательский прототип MARSWALK. Не сертифицирован NASA. "
        "Расчётные маршруты не гарантируют безопасность астронавтов."
    )
