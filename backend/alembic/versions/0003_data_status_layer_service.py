"""Data status REAL/DERIVED/SIMULATED, map layer service config, drop duplicate GiST indexes (Stage 5).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-14
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 0002 created two GiST indexes per geometry column: the explicit ix_* and GeoAlchemy2's automatic idx_*.
DUPLICATE_SPATIAL_INDEXES = (
    "idx_datasets_footprint",
    "idx_observations_geom",
    "idx_scientific_targets_geom",
    "idx_hazard_features_geom",
    "idx_routes_geom",
    "idx_route_segments_geom",
)


def upgrade() -> None:
    op.drop_constraint("ck_datasets_data_class", "datasets", type_="check")
    op.execute("UPDATE datasets SET data_class = 'REAL' WHERE data_class = 'MEASURED'")
    # Synthetic demonstration rows: SIMULATED is the status for artificially created data.
    op.execute("UPDATE datasets SET data_class = 'SIMULATED' WHERE data_class = 'ASSUMPTION'")
    # DERIVED now means "computed by MARSWALK"; the USGS geologic map is a published product.
    op.execute("UPDATE datasets SET data_class = 'REAL' WHERE id = 'usgs_sim3464_geologic_map'")
    op.create_check_constraint(
        "ck_datasets_data_class", "datasets", "data_class IN ('REAL','DERIVED','SIMULATED')"
    )
    op.add_column(
        "map_layers",
        sa.Column("service", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    for name in DUPLICATE_SPATIAL_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")


def downgrade() -> None:
    # The duplicate indexes are not recreated; ASSUMPTION rows cannot be told apart from SIMULATED.
    op.drop_column("map_layers", "service")
    op.drop_constraint("ck_datasets_data_class", "datasets", type_="check")
    op.execute("UPDATE datasets SET data_class = 'MEASURED' WHERE data_class = 'REAL'")
    op.execute("UPDATE datasets SET data_class = 'DERIVED' WHERE id = 'usgs_sim3464_geologic_map'")
    op.create_check_constraint(
        "ck_datasets_data_class",
        "datasets",
        "data_class IN ('MEASURED','DERIVED','SIMULATED','ASSUMPTION')",
    )
