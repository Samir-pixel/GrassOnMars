from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Dataset
from app.models.geo import MARS_SRID
from app.repositories.base import paginate


def list_datasets(
    db: Session,
    limit: int,
    offset: int,
    mission_id: str | None,
    integration_status: str | None,
) -> tuple[Sequence[Dataset], int]:
    stmt = select(Dataset).order_by(Dataset.id)
    if mission_id is not None:
        stmt = stmt.where(Dataset.mission_id == mission_id)
    if integration_status is not None:
        stmt = stmt.where(Dataset.integration_status == integration_status)
    return paginate(db, stmt, limit, offset)


def upsert_real_dataset(
    db: Session,
    dataset_id: str,
    *,
    step: dict[str, Any],
    metadata: dict[str, Any],
    bbox: Sequence[float] | None = None,
    **fields: Any,
) -> Dataset:
    """Create or refresh the provenance record of a connected NASA/USGS product. Caller commits.

    `step` is the acquisition entry for processing_history (re-running replaces the entry with
    the same name); `bbox` is west, south, east, north in degrees.
    """
    now = datetime.now(timezone.utc)
    dataset = db.get(Dataset, dataset_id) or Dataset(id=dataset_id)
    for name, value in fields.items():
        assert hasattr(Dataset, name), name
        setattr(dataset, name, value)
    dataset.data_class = "REAL"
    dataset.integration_status = "integrated"
    dataset.is_demonstration = False
    dataset.working_srid = MARS_SRID
    dataset.retrieved_at = now
    dataset.processing_history = [
        *(h for h in dataset.processing_history or [] if h.get("step") != step["step"]),
        {**step, "at": now.isoformat()},
    ]
    # "note_ru" is the placeholder text of catalogue rows that had no real data behind them yet.
    kept = {k: v for k, v in (dataset.extra_metadata or {}).items() if k != "note_ru"}
    dataset.extra_metadata = {**kept, **metadata}
    if bbox is not None:
        west, south, east, north = bbox
        dataset.footprint = WKTElement(
            f"POLYGON(({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))",
            srid=MARS_SRID,
        )
    db.add(dataset)
    db.flush()
    return dataset
