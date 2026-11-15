from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import DataClass


class TerrainPointRead(BaseModel):
    lat: float
    lon: float
    elevation_m: float | None = Field(description="Высота над ареоидом, м; null — в ячейке нет данных")
    data_class: DataClass
    provenance_ids: list[str] = Field(description="Наборы данных, из которых взято значение")
    resolution_m: float
    vertical_datum: str
    pixel_lat: float = Field(description="Центр ячейки сетки, значение которой возвращено")
    pixel_lon: float


class TerrainGridRead(BaseModel):
    data_class: DataClass
    provenance_ids: list[str]
    resolution_m: float = Field(description="Шаг исходной сетки, м")
    vertical_datum: str
    step: int = Field(description="Возвращена каждая step-я ячейка исходной сетки, значения не изменены")
    west: float = Field(description="Внешние границы возвращённой сетки, градусы")
    south: float
    east: float
    north: float
    rows: int
    cols: int
    cell_m: tuple[float, float] = Field(
        description="Расстояние между отсчётами на местности, м: запад–восток (на средней широте), север–юг"
    )
    elevation_f32_b64: str = Field(
        description="Высоты, м: float32 little-endian в base64, строки с севера на юг; NaN — нет данных"
    )


class EnvironmentSummaryRead(BaseModel):
    sol: int
    available_sols: list[int]
    data_class: DataClass = DataClass.DERIVED
    provenance_ids: list[str]
    observed_at_start: str
    observed_at_end: str
    air_temp_min_c: float | None = Field(default=None, description="Мин. температура воздуха по MEDA ATS, °C")
    air_temp_max_c: float | None = Field(default=None, description="Макс. температура воздуха по MEDA ATS, °C")
    pressure_min_pa: float | None = Field(default=None, description="Мин. давление по MEDA PS, Па")
    pressure_max_pa: float | None = Field(default=None, description="Макс. давление по MEDA PS, Па")
    wind_max_m_s: float | None = Field(default=None, description="Макс. горизонтальная скорость ветра по MEDA WS, м/с")
    humidity_max_pct: float | None = Field(default=None, description="Макс. относительная влажность по MEDA RHS, %")
    records: dict[str, int]


class TerrainAnalysisRead(TerrainGridRead):
    slope_deg_f32_b64: str
    roughness_m_f32_b64: str
    hillshade_u8_b64: str
    terrain_class_u8_b64: str
    metadata: dict[str, Any]
    quality_report: dict[str, Any]


class TerrainSlopePointRead(BaseModel):
    lat: float
    lon: float
    elevation_m: float | None
    slope_deg: float | None
    roughness_m: float | None
    terrain_class: str
    resolution_m: float
    data_class: DataClass = DataClass.DERIVED
    provenance_ids: list[str]
    coarse_for_eva: bool
    limitations: str


class TerrainProfilePointRead(BaseModel):
    distance_m: float
    lat: float
    lon: float
    elevation_m: float | None
    slope_deg: float | None


class TerrainProfileRead(BaseModel):
    data_class: DataClass = DataClass.DERIVED
    provenance_ids: list[str]
    resolution_m: float
    total_distance_m: float
    ascent_m: float
    descent_m: float
    points: list[TerrainProfilePointRead]



class LandingAssessmentRead(BaseModel):
    lat: float = Field(description="Центр ячейки сетки, для которой сделана проверка")
    lon: float
    suitable: bool = Field(description="Все критерии выполнены; это отбор для планирования, не гарантия безопасной посадки")
    criteria: list[dict[str, Any]]
    nearest_suitable: dict[str, float] | None = Field(description="Ближайшая ячейка, где выполнены все критерии; null — в окне такой нет")
    data_class: DataClass = DataClass.DERIVED
    provenance_ids: list[str]
    cell_m: tuple[float, float]
    criteria_source: str
    limitations: list[str]


class TerrainRegionRead(BaseModel):
    id: str
    west: float
    south: float
    east: float
    north: float
    step: int
    dataset_id: str
    resolution_m: float
    landing: dict[str, Any] = Field(description="Точка посадки по умолчанию: lat, lon и что это за точка")
    destinations: list[dict[str, Any]] = Field(description="Названные объекты IAU внутри окна, ближайшие первыми")
