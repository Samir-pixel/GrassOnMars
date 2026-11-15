from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Mission
from app.repositories.base import paginate


def list_missions(db: Session, limit: int, offset: int) -> tuple[Sequence[Mission], int]:
    stmt = select(Mission).options(selectinload(Mission.instruments)).order_by(Mission.launch_date)
    return paginate(db, stmt, limit, offset)
