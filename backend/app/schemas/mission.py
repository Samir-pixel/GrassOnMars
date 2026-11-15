from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class MissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    agency: str
    launch_date: date
    instruments: list[str] = Field(description="Акронимы приборов миссии")
    description_ru: str
    url: str | None
