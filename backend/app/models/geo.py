"""MARSWALK PostGIS ORM models (Stage 4).

Raster pixels are never stored here — only metadata, geometries, and file
references (COG / GeoTIFF paths under data/).
All geometries use Mars SRID 949900 (IAU_2015 Mars 2000 planetocentric).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# Canonical display CRS (degrees). Metric analysis CRS is 949918 (see CRS_STRATEGY).
MARS_SRID = 949900
MARS_METRIC_SRID = 949918


class Mission(Base):
    """NASA (or NASA-data) mission that supplies science products."""

    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    agency: Mapped[str]
    launch_date: Mapped[date] = mapped_column(Date)
    description_ru: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)

    instruments: Mapped[list[Instrument]] = relationship(back_populates="mission")
    datasets: Mapped[list[Dataset]] = relationship(back_populates="mission")


class Instrument(Base):
    """Instrument flown on a mission (MOLA, CTX, HiRISE, THEMIS, MEDA, …)."""

    __tablename__ = "instruments"

    id: Mapped[str] = mapped_column(primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    name: Mapped[str]
    acronym: Mapped[str]
    description_ru: Mapped[str] = mapped_column(Text)

    mission: Mapped[Mission] = relationship(back_populates="instruments")
    datasets: Mapped[list[Dataset]] = relationship(back_populates="instrument")


class Dataset(Base):
    """Scientific product registry with full provenance and optional COG path."""

    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint(
            "data_class IN ('REAL','DERIVED','SIMULATED')",
            name="ck_datasets_data_class",
        ),
        CheckConstraint(
            "integration_status IN ('not_integrated','integrated','unavailable')",
            name="ck_datasets_integration_status",
        ),
        Index("ix_datasets_footprint", "footprint", postgresql_using="gist"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str]
    mission_id: Mapped[str | None] = mapped_column(ForeignKey("missions.id"), index=True)
    instrument_id: Mapped[str | None] = mapped_column(ForeignKey("instruments.id"), index=True)
    provider: Mapped[str]
    product_id: Mapped[str | None]
    doi: Mapped[str | None]
    data_class: Mapped[str]
    observed_at_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    observed_at_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processing_level: Mapped[str | None]
    spatial_resolution_m: Mapped[float | None]
    native_crs_wkt: Mapped[str | None] = mapped_column(Text)
    working_srid: Mapped[int] = mapped_column(Integer, default=MARS_SRID)
    vertical_datum: Mapped[str | None] = mapped_column(Text)
    source_archive: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    # External raster reference only (never a bytea blob).
    raster_uri: Mapped[str | None] = mapped_column(Text)
    sha256_checksum: Mapped[str | None]
    processing_history: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    known_limitations: Mapped[str | None] = mapped_column(Text)
    license_note: Mapped[str | None] = mapped_column(Text)
    integration_status: Mapped[str]
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
    footprint: Mapped[Any | None] = mapped_column(Geometry("POLYGON", srid=MARS_SRID, spatial_index=False))

    mission: Mapped[Mission | None] = relationship(back_populates="datasets")
    instrument: Mapped[Instrument | None] = relationship(back_populates="datasets")
    map_layers: Mapped[list[MapLayer]] = relationship(back_populates="dataset")


class DatasetLineage(Base):
    """Parent → child provenance links for derived products."""

    __tablename__ = "dataset_lineage"
    __table_args__ = (UniqueConstraint("dataset_id", "parent_dataset_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    parent_dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)


class MapLayer(Base):
    """Cartographic presentation of a dataset (WMTS, COG, or vector)."""

    __tablename__ = "map_layers"

    id: Mapped[str] = mapped_column(primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    title_ru: Mapped[str]
    kind: Mapped[str]
    z_index: Mapped[int] = mapped_column(Integer)
    visible_by_default: Mapped[bool] = mapped_column(Boolean, default=False)
    legend_spec: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # How the client reaches the layer (tile URL, native CRS, zoom range, attribution).
    service: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    dataset: Mapped[Dataset] = relationship(back_populates="map_layers")


class Observation(Base):
    """Point observation (e.g. MEDA sample) with UTC timestamp and payload."""

    __tablename__ = "observations"
    __table_args__ = (Index("ix_observations_geom", "geom", postgresql_using="gist"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    source_record_id: Mapped[str | None]
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    geom: Mapped[Any] = mapped_column(Geometry("POINT", srid=MARS_SRID, spatial_index=False))
    values: Mapped[dict[str, Any]] = mapped_column(JSONB)
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)


class ScientificTarget(Base):
    """Geologic / nomenclature / rover target of interest."""

    __tablename__ = "scientific_targets"
    __table_args__ = (Index("ix_scientific_targets_geom", "geom", postgresql_using="gist"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id"), index=True)
    name: Mapped[str]
    category: Mapped[str] = mapped_column(index=True)
    description_ru: Mapped[str] = mapped_column(Text)
    geom: Mapped[Any] = mapped_column(Geometry("GEOMETRY", srid=MARS_SRID, spatial_index=False))
    elevation_m: Mapped[float | None]
    rover_sol: Mapped[int | None]
    source_identifier: Mapped[str | None]
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)


class HazardFeature(Base):
    """Vector hazard polygon/point derived or assumed for planning (not NASA safety cert)."""

    __tablename__ = "hazard_features"
    __table_args__ = (Index("ix_hazard_features_geom", "geom", postgresql_using="gist"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id"), index=True)
    hazard_class: Mapped[str] = mapped_column(index=True)
    title_ru: Mapped[str]
    description_ru: Mapped[str] = mapped_column(Text)
    geom: Mapped[Any] = mapped_column(Geometry("GEOMETRY", srid=MARS_SRID, spatial_index=False))
    factors: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)


class Route(Base):
    """Traverse request / computed path as a LineString on Mars."""

    __tablename__ = "routes"
    __table_args__ = (Index("ix_routes_geom", "geom", postgresql_using="gist"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    status: Mapped[str]
    profile: Mapped[str | None]
    # Ordered waypoints as JSON for API round-trip; geom is the spatial authority when present.
    waypoints: Mapped[list[dict[str, float]]] = mapped_column(JSONB)
    geom: Mapped[Any | None] = mapped_column(Geometry("LINESTRING", srid=MARS_SRID, spatial_index=False))
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    provenance_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)

    segments: Mapped[list[RouteSegment]] = relationship(back_populates="route")
    simulations: Mapped[list[Simulation]] = relationship(back_populates="route")
    reports: Mapped[list[MissionReport]] = relationship(back_populates="route")


class RouteSegment(Base):
    """Ordered segment of a route with per-segment metrics."""

    __tablename__ = "route_segments"
    __table_args__ = (
        UniqueConstraint("route_id", "seq"),
        Index("ix_route_segments_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"), index=True)
    seq: Mapped[int]
    geom: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=MARS_SRID, spatial_index=False))
    length_m: Mapped[float | None] = mapped_column(Float)
    max_slope_deg: Mapped[float | None] = mapped_column(Float)
    hazard_class: Mapped[str | None]
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    route: Mapped[Route] = relationship(back_populates="segments")


class Simulation(Base):
    """Time-stepped EVA simulation request / result tied to a route."""

    __tablename__ = "simulations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"), index=True)
    status: Mapped[str]
    assumptions: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    timeline_events: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)

    route: Mapped[Route] = relationship(back_populates="simulations")


class MissionReport(Base):
    """Printable mission briefing request / snapshot for a route."""

    __tablename__ = "mission_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"), index=True)
    status: Mapped[str]
    meda_reference_sol: Mapped[int | None]
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_demonstration: Mapped[bool] = mapped_column(Boolean, default=False)

    route: Mapped[Route] = relationship(back_populates="reports")
