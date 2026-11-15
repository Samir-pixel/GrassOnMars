from collections.abc import Sequence
from uuid import UUID

from geoalchemy2 import WKTElement
from geoalchemy2.functions import ST_AsGeoJSON, ST_Centroid, ST_DWithin, ST_Intersects, ST_MakeEnvelope, ST_MakePoint
from geoalchemy2.functions import ST_SetSRID, ST_Transform, ST_X, ST_Y
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.models import HazardFeature, MissionReport, Route, ScientificTarget, Simulation
from app.models.geo import MARS_METRIC_SRID, MARS_SRID
from app.repositories.base import paginate


def list_targets(
    db: Session,
    limit: int,
    offset: int,
    category: str | None,
    *,
    include_demo: bool = True,
    lat: float | None = None,
    lon: float | None = None,
    radius_m: float | None = None,
    min_lon: float | None = None,
    min_lat: float | None = None,
    max_lon: float | None = None,
    max_lat: float | None = None,
) -> tuple[Sequence[ScientificTarget], int]:
    stmt = select(ScientificTarget).order_by(
        case((ScientificTarget.id.like("sci_%"), 0), else_=1),
        ScientificTarget.id,
    )
    if not include_demo:
        stmt = stmt.where(ScientificTarget.is_demonstration.is_(False))
    if category is not None:
        stmt = stmt.where(ScientificTarget.category == category)
    if lat is not None and lon is not None and radius_m is not None:
        # Metric CRS 949918 — never Earth geography / EPSG:4326.
        origin = ST_Transform(
            ST_SetSRID(ST_MakePoint(lon, lat), MARS_SRID),
            MARS_METRIC_SRID,
        )
        stmt = stmt.where(
            ST_DWithin(ST_Transform(ScientificTarget.geom, MARS_METRIC_SRID), origin, radius_m)
        )
    if None not in (min_lon, min_lat, max_lon, max_lat):
        envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, MARS_SRID)
        stmt = stmt.where(ST_Intersects(ScientificTarget.geom, envelope))
    return paginate(db, stmt, limit, offset)


def real_target_points(db: Session, min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list[dict]:
    """Non-demonstration science targets of a bbox with their coordinates, in one query."""
    rows = db.execute(
        select(
            ScientificTarget.id,
            ScientificTarget.name,
            ScientificTarget.rover_sol,
            ScientificTarget.dataset_id,
            ST_X(ScientificTarget.geom).label("lon"),
            ST_Y(ScientificTarget.geom).label("lat"),
        )
        .where(
            ScientificTarget.is_demonstration.is_(False),
            ST_Intersects(ScientificTarget.geom, ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, MARS_SRID)),
        )
        .order_by(ScientificTarget.id)
    )
    return [dict(r._mapping) for r in rows]


def rover_position(db: Session, sol: int) -> dict | None:
    """The rover's latest localisation on or before a sol: where its instruments measured on that sol."""
    waypoints = and_(ScientificTarget.category == "rover_waypoint", ScientificTarget.is_demonstration.is_(False))
    last_sol = select(func.max(ScientificTarget.rover_sol)).where(waypoints, ScientificTarget.rover_sol <= sol)
    rows = db.execute(
        select(
            ScientificTarget.id.label("waypoint_id"),
            ScientificTarget.rover_sol.label("waypoint_sol"),
            ScientificTarget.dataset_id,
            ScientificTarget.source_identifier,
            ST_X(ScientificTarget.geom).label("lon"),
            ST_Y(ScientificTarget.geom).label("lat"),
        ).where(waypoints, ScientificTarget.rover_sol == last_sol.scalar_subquery())
    ).all()
    if not rows:
        return None
    # Several localisations can share a sol; the highest site_drive counter ("4_218") is the last one.
    last = max(rows, key=lambda r: tuple(int(n) for n in r.source_identifier.split("_")))
    return {k: v for k, v in last._mapping.items() if k != "source_identifier"}


def target_lon_lat(db: Session, target_id: str) -> tuple[float, float] | None:
    row = db.execute(
        select(ST_X(ScientificTarget.geom), ST_Y(ScientificTarget.geom)).where(
            ScientificTarget.id == target_id
        )
    ).one_or_none()
    if row is None:
        return None
    return float(row[0]), float(row[1])


def list_hazard_features(
    db: Session,
    limit: int,
    offset: int,
    *,
    hazard_class: str | None = None,
    include_demo: bool = True,
    lat: float | None = None,
    lon: float | None = None,
    radius_m: float | None = None,
    min_lon: float | None = None,
    min_lat: float | None = None,
    max_lon: float | None = None,
    max_lat: float | None = None,
) -> tuple[Sequence[HazardFeature], int]:
    stmt = select(HazardFeature).order_by(HazardFeature.hazard_class)
    if hazard_class is not None:
        stmt = stmt.where(HazardFeature.hazard_class == hazard_class)
    if not include_demo:
        stmt = stmt.where(HazardFeature.is_demonstration.is_(False))
    if lat is not None and lon is not None and radius_m is not None:
        origin = ST_Transform(
            ST_SetSRID(ST_MakePoint(lon, lat), MARS_SRID),
            MARS_METRIC_SRID,
        )
        stmt = stmt.where(
            ST_DWithin(ST_Transform(HazardFeature.geom, MARS_METRIC_SRID), origin, radius_m)
        )
    if None not in (min_lon, min_lat, max_lon, max_lat):
        envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, MARS_SRID)
        stmt = stmt.where(ST_Intersects(HazardFeature.geom, envelope))
    return paginate(db, stmt, limit, offset)


def hazard_geom_info(db: Session, hazard_id: UUID) -> tuple[float, float, str] | None:
    row = db.execute(
        select(
            ST_X(ST_Centroid(HazardFeature.geom)),
            ST_Y(ST_Centroid(HazardFeature.geom)),
            ST_AsGeoJSON(HazardFeature.geom),
        ).where(HazardFeature.id == hazard_id)
    ).one_or_none()
    if row is None:
        return None
    return float(row[0]), float(row[1]), str(row[2])


def create_route(
    db: Session,
    waypoints: list[dict[str, float]],
    status: str,
) -> Route:
    coords = ", ".join(f"{p['lon']} {p['lat']}" for p in waypoints)
    geom = WKTElement(f"LINESTRING({coords})", srid=MARS_SRID)
    route = Route(waypoints=waypoints, status=status, geom=geom, metrics={}, provenance_ids=[])
    db.add(route)
    db.commit()
    db.refresh(route)
    return route


def get_route(db: Session, route_id: UUID) -> Route | None:
    return db.get(Route, route_id)


def create_simulation(
    db: Session, route_id: UUID, status: str, assumptions: dict
) -> Simulation:
    row = Simulation(route_id=route_id, status=status, assumptions=assumptions)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def create_report(
    db: Session, route_id: UUID, status: str, meda_reference_sol: int | None
) -> MissionReport:
    row = MissionReport(
        route_id=route_id,
        status=status,
        meda_reference_sol=meda_reference_sol,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
