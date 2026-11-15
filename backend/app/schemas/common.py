from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class DataClass(StrEnum):
    REAL = "REAL"  # real scientific data from NASA / USGS archives and services
    DERIVED = "DERIVED"  # computed by MARSWALK from REAL data
    SIMULATED = "SIMULATED"  # demonstration or artificially created data


class IntegrationStatus(StrEnum):
    NOT_INTEGRATED = "not_integrated"
    INTEGRATED = "integrated"
    UNAVAILABLE = "unavailable"


class MarsCoord(BaseModel):
    lat: float = Field(
        ge=-90, le=90, allow_inf_nan=False, description="Планетоцентрическая широта, градусы"
    )
    lon: float = Field(
        ge=-180,
        le=360,
        allow_inf_nan=False,
        description="Восточная долгота, градусы (0…360 или −180…180)",
    )

    @field_validator("lon")
    @classmethod
    def _to_signed_longitude(cls, lon: float) -> float:
        # One stored convention (−180…180], so 282.42°E and −77.58° are the same point.
        return lon - 360 if lon > 180 else lon


class Page[T](BaseModel):
    items: list[T]
    total: int = Field(description="Всего записей, подходящих под фильтр")
    limit: int
    offset: int


class ErrorBody(BaseModel):
    code: str
    message_ru: str
    details: dict[str, Any] = {}
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody
