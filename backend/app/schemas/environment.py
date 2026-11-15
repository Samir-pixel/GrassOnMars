from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import DataClass


class ObservationKind(StrEnum):
    HISTORICAL_OBSERVATION = "HISTORICAL_OBSERVATION"
    PROCESSED_OBSERVATION = "PROCESSED_OBSERVATION"
    MODEL_ESTIMATE = "MODEL_ESTIMATE"
    SIMULATION = "SIMULATION"


class EnvParameter(StrEnum):
    AIR_TEMPERATURE = "air_temperature"
    PRESSURE = "pressure"
    WIND_SPEED = "wind_speed"
    WIND_DIRECTION = "wind_direction"


class RoverPositionRead(BaseModel):
    sol: int
    lat: float
    lon: float
    waypoint_id: str
    waypoint_sol: int = Field(description="Сол последней локализации марсохода не позже sol")
    dataset_id: str | None


class EnvPlaceRead(BaseModel):
    name: str
    lat: float | None
    lon: float | None


class EnvSourceRead(BaseModel):
    id: str
    parameters: list[str]
    instrument: str
    mission: str
    location: EnvPlaceRead
    kind: ObservationKind
    availability: Literal["series", "map", "not_acquired", "not_integrated"]
    dataset_ids: list[str]
    data_class: DataClass | None
    processing_level: str | None
    source_url: str | None
    available_sols: list[int]
    observed_at_start: str | None
    observed_at_end: str | None
    note: str


class EnvParameterRead(BaseModel):
    id: str
    label: str
    unit: str | None
    series: bool = Field(description="Есть ли временной ряд; иначе см. sources")


class EnvStationRead(BaseModel):
    id: str
    name: str
    available: bool


class EnvRegistryRead(BaseModel):
    notice: str
    kinds: dict[ObservationKind, str]
    parameters: list[EnvParameterRead]
    stations: list[EnvStationRead]
    sources: list[EnvSourceRead]
    positions: list[RoverPositionRead] = Field(description="Где стоял марсоход в загруженные солы")


class EnvPointRead(BaseModel):
    time_utc: str = Field(description="UTC первой записи интервала")
    lmst_h: float = Field(description="Начало интервала, часы местного среднего солнечного времени")
    value: float | None = Field(description="null — в интервале нет пригодных значений")
    min: float | None
    max: float | None
    samples: int
    valid_share: float = Field(description="Доля ячеек архива с пригодным значением")


class EnvProductRead(BaseModel):
    lidvid: str
    label_url: str
    table_url: str
    processing_level: str
    md5: str
    records: int


class EnvQualityRead(BaseModel):
    samples: int
    bins: int
    empty_bins: int
    note: str


class EnvSeriesRead(BaseModel):
    parameter: EnvParameter
    label: str
    unit: str
    kind: ObservationKind
    data_class: DataClass
    provenance_ids: list[str]
    station: str
    mission: str
    instrument: str
    source_dataset: str
    product: EnvProductRead
    sol: int
    available_sols: list[int]
    observed_at_start: str
    observed_at_end: str
    location: RoverPositionRead | None = Field(description="null — положение марсохода на этот сол не загружено")
    bin_minutes: int
    lmst_from: float
    lmst_to: float
    method: str
    quality: EnvQualityRead
    notice: str
    points: list[EnvPointRead]
