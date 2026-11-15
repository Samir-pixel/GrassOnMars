from collections.abc import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


def paginate[T](
    db: Session, stmt: Select[tuple[T]], limit: int, offset: int
) -> tuple[Sequence[T], int]:
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    return db.scalars(stmt.limit(limit).offset(offset)).all(), total
