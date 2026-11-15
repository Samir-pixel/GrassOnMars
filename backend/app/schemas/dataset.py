from datetime import datetime
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.schemas.common import DataClass, IntegrationStatus


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    mission_id: str | None
    instrument_id: str | None
    provider: str
    product_id: str | None = None
    data_class: DataClass
    observed_at_start: datetime | None
    observed_at_end: datetime | None
    spatial_resolution_m: float | None
    native_crs_wkt: str | None = None
    working_srid: int
    source_archive: str | None = None
    source_url: str | None
    raster_uri: str | None = Field(
        default=None,
        description="Путь к внешнему GeoTIFF/COG; пиксели в БД не хранятся",
    )
    processing_level: str | None = None
    retrieved_at: datetime | None = None
    license_note: str | None = None
    integration_status: IntegrationStatus
    is_demonstration: bool = False
    metadata: dict[str, Any] = Field(validation_alias=AliasChoices("extra_metadata", "metadata"))
