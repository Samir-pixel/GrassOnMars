from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MapLayer
from app.repositories.base import paginate


def get_layer(db: Session, layer_id: str) -> MapLayer | None:
    return db.get(MapLayer, layer_id)


def list_layers(db: Session, limit: int, offset: int) -> tuple[Sequence[MapLayer], int]:
    return paginate(db, select(MapLayer).options(selectinload(MapLayer.dataset)).order_by(MapLayer.z_index, MapLayer.id), limit, offset)
