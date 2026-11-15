from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.common import ErrorResponse

DbSession = Annotated[Session, Depends(get_db)]

Lat = Annotated[float, Query(ge=-90, le=90, description="Планетоцентрическая широта, градусы")]
Lon = Annotated[
    float, Query(ge=-180, le=360, description="Восточная долгота, градусы (0…360 или −180…180)")
]


@dataclass(frozen=True)
class PageParams:
    limit: Annotated[int, Query(ge=1, le=100, description="Размер страницы")] = 50
    offset: Annotated[int, Query(ge=0, description="Сколько записей пропустить")] = 0


Pagination = Annotated[PageParams, Depends()]

NOT_INTEGRATED: dict[int | str, dict[str, Any]] = {
    503: {"model": ErrorResponse, "description": "Данные или расчёт ещё не подключены"}
}
