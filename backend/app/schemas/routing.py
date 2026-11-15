from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import MarsCoord


class RouteMode(StrEnum):
    SHORTEST = "SHORTEST"
    LOWEST_TERRAIN_RISK = "LOWEST_TERRAIN_RISK"
    SCIENCE_PRIORITY = "SCIENCE_PRIORITY"


class RouteWeights(BaseModel):
    """Overrides of a mode's preset weights; unset fields keep the preset."""

    distance: float | None = Field(default=None, gt=0, le=100)
    slope: float | None = Field(default=None, ge=0, le=100)
    roughness: float | None = Field(default=None, ge=0, le=100)
    hazard: float | None = Field(default=None, ge=0, le=100)
    uncertainty: float | None = Field(default=None, ge=0, le=100)
    science: float | None = Field(default=None, ge=0, le=100)


class RoutePlanRequest(BaseModel):
    start: MarsCoord
    destination: MarsCoord
    waypoints: list[MarsCoord] = Field(default_factory=list, max_length=5, description="Промежуточные научные точки по порядку")
    modes: list[RouteMode] = Field(default=list(RouteMode), min_length=1)
    algorithm: Literal["astar", "dijkstra"] = Field(default="astar", description="dijkstra — эталон для проверки A*")
    max_slope_deg: float | None = Field(
        default=None, gt=0, le=90, description="Предпочтение пользователя: ячейки круче исключаются во всех режимах"
    )
    science_radius_m: float = Field(default=200.0, gt=0, le=2000)
    weights: dict[Literal["LOWEST_TERRAIN_RISK", "SCIENCE_PRIORITY"], RouteWeights] = Field(
        default_factory=dict, description="SHORTEST не настраивается: это базовая линия сравнения"
    )
    # The CTX window the graph is built from: by default the Jezero window of /terrain/analysis.
    west: float = Field(default=77.3, ge=-180, le=360)
    south: float = Field(default=18.3, ge=-90, le=90)
    east: float = Field(default=77.6, ge=-180, le=360)
    north: float = Field(default=18.55, ge=-90, le=90)
    step: int = Field(default=3, ge=1, le=50)


class RoutePointRead(BaseModel):
    lat: float
    lon: float
    elevation_m: float | None
    snapped_m: float = Field(description="Сдвиг запрошенной точки к центру ячейки, м")


class ScienceTargetNearRoute(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    rover_sol: int | None
    distance_to_route_m: float


class RouteAlternativeRead(BaseModel):
    mode: RouteMode
    status: Literal["found", "unreachable"]
    reason: str | None = None
    algorithm: str
    weights: dict[str, float]
    constraints: list[str]
    nodes_expanded: int
    same_route_as: RouteMode | None = None
    explanation: str | None = None
    geometry: dict[str, Any] | None = Field(default=None, description="GeoJSON LineString, [lon, lat], центры ячеек")
    total_distance_m: float | None = Field(default=None, description="Длина по поверхности с учётом перепада высот")
    extra_distance_vs_shortest_m: float | None = None
    ascent_m: float | None = None
    descent_m: float | None = None
    max_slope_deg: float | None = None
    mean_slope_deg: float | None = None
    terrain: dict[str, Any] | None = None
    hazard: dict[str, Any] | None = None
    data_quality: dict[str, float] | None = None
    science_targets: list[ScienceTargetNearRoute] = []
    elevation_profile: list[dict[str, float]] = []
    cost: dict[str, float] | None = Field(default=None, description="Взвешенные метры по слагаемым формулы")


class RoutePlanRead(BaseModel):
    data_class: str
    provenance_ids: list[str]
    start: RoutePointRead
    destination: RoutePointRead
    grid: dict[str, Any]
    alternatives: list[RouteAlternativeRead]
    cost_model: dict[str, Any]
    limitations: list[str]
    warnings: list[str]
