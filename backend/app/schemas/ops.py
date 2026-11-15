from datetime import datetime
from uuid import UUID

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import MarsCoord


class RouteCreate(BaseModel):
    points: list[MarsCoord] = Field(min_length=2, description="Минимум старт и финиш")

    @field_validator("points")
    @classmethod
    def _at_least_two(cls, points: list[MarsCoord]) -> list[MarsCoord]:
        if len(points) < 2:
            raise ValueError("Нужны минимум две точки: старт и финиш")
        return points


class RouteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    created_at: datetime
    points: list[dict[str, float]] = Field(
        validation_alias="waypoints",
        serialization_alias="points",
    )
    status: str
    message_ru: str = (
        "Маршрут сохранён как введён. Расчёт вариантов по рельефу — POST /api/v1/routes/plan."
    )


class TargetRead(BaseModel):
    id: str
    name: str
    category: str
    description_ru: str
    lat: float
    lon: float
    dataset_id: str | None
    elevation_m: float | None
    rover_sol: int | None
    is_demonstration: bool = False
    source_identifier: str | None = None
    geometry: dict[str, Any] | None = None
    classification: str | None = None
    evidence_level: str | None = None
    confidence: float | None = None
    instrument: str | None = None
    observed_at: str | None = None
    source_citation: str | None = None
    image_url: str | None = None
    image_credit: str | None = None
    data_class: str | None = None


class HazardFeatureRead(BaseModel):
    id: UUID
    hazard_class: str
    title_ru: str
    description_ru: str
    dataset_id: str | None
    factors: dict
    is_demonstration: bool
    lat: float | None = None
    lon: float | None = None
    geometry: dict[str, Any] | None = None


class HazardGridRead(BaseModel):
    data_class: str
    provenance_ids: list[str]
    west: float
    south: float
    east: float
    north: float
    rows: int
    cols: int
    cell_m: tuple[float, float]
    weights: dict[str, float]
    thresholds: dict[str, float]
    class_counts: dict[str, int]
    risk_u8_b64: str
    class_u8_b64: str
    uncertainty_u8_b64: str
    disclaimer: str


class HazardAssessmentRead(BaseModel):
    lat: float
    lon: float
    elevation_m: float | None
    slope_deg: float | None
    roughness_m: float | None
    data_class: str
    hazard_class: str
    hazard_type: str
    risk_score: float
    confidence: float
    components: dict[str, float | None]
    reasons: list[str]
    recommendations: list[str]
    sources: list[str]
    observation_dates: dict[str, str]
    detection_method: str
    disclaimer: str


class SimulationCreate(BaseModel):
    route_id: UUID
    assumptions: dict = Field(default_factory=dict)


class SimulationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    route_id: UUID
    status: str
    assumptions: dict
    message_ru: str = (
        "Запрос симуляции сохранён. Пошаговая EVA-модель ещё не подключена (этап 13)."
    )


class ReportCreate(BaseModel):
    route_id: UUID
    meda_reference_sol: int | None = Field(default=None, ge=0)


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    route_id: UUID
    status: str
    meda_reference_sol: int | None
    message_ru: str = (
        "Запрос отчёта сохранён. Генерация печатного брифинга ещё не подключена (этап 14)."
    )
