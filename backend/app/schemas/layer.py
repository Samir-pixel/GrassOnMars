from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    title_ru: str
    kind: str
    z_index: int
    visible_by_default: bool
    legend_spec: dict[str, Any] = Field(default_factory=dict)
    service: dict[str, Any] = Field(
        default_factory=dict,
        description="Подключение слоя: шаблон тайлов, родная СК, диапазон масштабов, источник",
    )
    data_class: str | None = None
    resolution_m: float | None = None
    observed_at: str | None = None
    source_name: str | None = None
    processing_status: str | None = None
    limitations_ru: str | None = None
