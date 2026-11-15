from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.integrations import crism, ctx_dtm, hazard_detection, landing, meda, mola, route_planner, scientific_discovery, terrain_analysis as ta, trek
from app.integrations import environment
from app.integrations.http import shared_client
from app.repositories import datasets as dataset_repo
from app.repositories import layers as layer_repo
from app.repositories import missions as mission_repo
from app.repositories import ops as ops_repo
from app.schemas.common import IntegrationStatus, MarsCoord, Page
from app.schemas.dataset import DatasetRead
from app.schemas.environment import EnvRegistryRead, EnvSeriesRead
from app.schemas.layer import LayerRead
from app.schemas.mission import MissionRead
from app.schemas.ops import (
    HazardAssessmentRead,
    HazardFeatureRead,
    HazardGridRead,
    ReportCreate,
    ReportRead,
    RouteCreate,
    RouteRead,
    SimulationCreate,
    SimulationRead,
    TargetRead,
)
from app.schemas.routing import RoutePlanRead, RoutePlanRequest, RoutePointRead
from app.schemas.terrain import (
    EnvironmentSummaryRead,
    LandingAssessmentRead,
    TerrainAnalysisRead,
    TerrainGridRead,
    TerrainPointRead,
    TerrainProfileRead,
    TerrainRegionRead,
    TerrainSlopePointRead,
)


def list_missions(db: Session, limit: int, offset: int) -> Page[MissionRead]:
    rows, total = mission_repo.list_missions(db, limit, offset)
    items = [
        MissionRead(
            id=r.id,
            name=r.name,
            agency=r.agency,
            launch_date=r.launch_date,
            instruments=[i.acronym for i in r.instruments],
            description_ru=r.description_ru,
            url=r.url,
        )
        for r in rows
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


def list_datasets(
    db: Session,
    limit: int,
    offset: int,
    mission_id: str | None,
    integration_status: IntegrationStatus | None,
) -> Page[DatasetRead]:
    status = integration_status.value if integration_status else None
    rows, total = dataset_repo.list_datasets(db, limit, offset, mission_id, status)
    return Page(
        items=[DatasetRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def list_layers(db: Session, limit: int, offset: int) -> Page[LayerRead]:
    rows, total = layer_repo.list_layers(db, limit, offset)
    items: list[LayerRead] = []
    for r in rows:
        item = LayerRead.model_validate(r)
        if r.dataset is not None:
            item.data_class = r.dataset.data_class
            item.resolution_m = r.dataset.spatial_resolution_m
            obs = r.dataset.observed_at_start
            item.observed_at = obs.date().isoformat() if obs else (r.dataset.extra_metadata or {}).get("publication_date")
            item.source_name = r.dataset.provider
            item.processing_status = r.dataset.integration_status
            item.limitations_ru = r.dataset.known_limitations
        items.append(item)
    return Page(items=items, total=total, limit=limit, offset=offset)


def get_layer_image(db: Session, layer_id: str) -> tuple[bytes, str]:
    layer = layer_repo.get_layer(db, layer_id)
    if layer is None or layer.kind != "image_overlay":
        raise AppError(404, "LAYER_NOT_FOUND", "Растровый слой не найден.", {"layer_id": layer_id})
    if layer_id == crism.LAYER_ID:
        path = crism.png_path()
        if not path.exists():
            raise AppError(503, "DATASET_NOT_ACQUIRED", "Слой CRISM ещё не загружен: выполните python -m app.integrations.crism.")
        return path.read_bytes(), "image/png"
    raise AppError(404, "LAYER_NOT_FOUND", "Изображение слоя отсутствует.", {"layer_id": layer_id})


def get_layer_tile(db: Session, layer_id: str, z: int, row: int, col: int) -> tuple[bytes, str]:
    layer = layer_repo.get_layer(db, layer_id)
    if layer is None or layer.service.get("type") != "wmts":
        raise AppError(404, "LAYER_NOT_FOUND", "Тайловый слой не найден.", {"layer_id": layer_id})
    client = shared_client()
    wmts, _ = trek.get_capabilities(layer.service["identifier"], client)
    return trek.get_tile(wmts, z, row, col, client), wmts.media_type


def list_targets(
    db: Session,
    limit: int,
    offset: int,
    category: str | None,
    *,
    include_demo: bool = True,
    evidence_level: str | None = None,
    instrument: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    radius_m: float | None = None,
    min_lon: float | None = None,
    min_lat: float | None = None,
    max_lon: float | None = None,
    max_lat: float | None = None,
) -> Page[TargetRead]:
    if lon is not None and lon > 180:
        lon = lon - 360
    # When filtering by metadata stored in the scientific discovery registry, inspect the matching slice cleanly.
    post_filter = evidence_level is not None or instrument is not None
    rows, total = ops_repo.list_targets(
        db,
        1000 if post_filter else limit,
        0 if post_filter else offset,
        category,
        include_demo=include_demo,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
    )
    items: list[TargetRead] = []
    for row in rows:
        coords = ops_repo.target_lon_lat(db, row.id)
        if coords is None:
            continue
        lon_v, lat_v = coords
        meta = scientific_discovery.enrich_target(
            row.id,
            dataset_id=row.dataset_id,
            rover_sol=row.rover_sol,
            source_identifier=row.source_identifier,
            is_demo=row.is_demonstration,
        )
        if evidence_level is not None and meta["evidence_level"] != evidence_level:
            continue
        if instrument is not None and instrument.lower() not in (meta["instrument"] or "").lower():
            continue
        items.append(
            TargetRead(
                id=row.id,
                name=row.name,
                category=row.category,
                description_ru=row.description_ru,
                lat=lat_v,
                lon=lon_v,
                dataset_id=row.dataset_id,
                elevation_m=row.elevation_m,
                rover_sol=row.rover_sol,
                is_demonstration=row.is_demonstration,
                source_identifier=row.source_identifier,
                geometry={"type": "Point", "coordinates": [lon_v, lat_v]},
                **meta,
            )
        )
    if post_filter:
        total = len(items)
        items = items[offset : offset + limit]
    return Page(items=items, total=total, limit=limit, offset=offset)


def list_hazards(
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
) -> Page[HazardFeatureRead]:
    import json

    if lon is not None and lon > 180:
        lon = lon - 360
    rows, total = ops_repo.list_hazard_features(
        db,
        limit,
        offset,
        hazard_class=hazard_class,
        include_demo=include_demo,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
    )
    items: list[HazardFeatureRead] = []
    for r in rows:
        ginfo = ops_repo.hazard_geom_info(db, r.id)
        lon_v, lat_v, geom = (ginfo[0], ginfo[1], json.loads(ginfo[2])) if ginfo else (None, None, None)
        items.append(
            HazardFeatureRead(
                id=r.id,
                hazard_class=r.hazard_class,
                title_ru=r.title_ru,
                description_ru=r.description_ru,
                dataset_id=r.dataset_id,
                factors=r.factors,
                is_demonstration=r.is_demonstration,
                lat=lat_v,
                lon=lon_v,
                geometry=geom,
            )
        )
    return Page(items=items, total=total, limit=limit, offset=offset)


def hazard_grid(
    west: float,
    south: float,
    east: float,
    north: float,
    step: int,
    cfg: hazard_detection.RiskConfig,
) -> HazardGridRead:
    west, east = (v - 360 if v > 180 else v for v in (west, east))
    return HazardGridRead(**hazard_detection._grid_arrays(west, south, east, north, step, cfg))


def assess_hazard_point(lat: float, lon: float, cfg: hazard_detection.RiskConfig) -> HazardAssessmentRead:
    if lon > 180:
        lon = lon - 360
    return HazardAssessmentRead(**hazard_detection.assess_point(lat, lon, cfg))


def create_route(db: Session, body: RouteCreate) -> RouteRead:
    waypoints = [{"lat": p.lat, "lon": p.lon} for p in body.points]
    route = ops_repo.create_route(db, waypoints, status=IntegrationStatus.NOT_INTEGRATED.value)
    return RouteRead.model_validate(route)


def plan_route(db: Session, body: RoutePlanRequest) -> RoutePlanRead:
    west, east = (v - 360 if v > 180 else v for v in (body.west, body.east))
    grid = route_planner.terrain_grid(west, body.south, east, body.north, body.step)
    cells, points = [], []
    for name, p in (("start", body.start), ("destination", body.destination)):
        cell = grid.cell_of(p.lat, p.lon)
        if cell is None:
            raise AppError(
                422,
                "OUTSIDE_COVERAGE",
                "Точка маршрута вне сетки рельефа региона.",
                {"point": name, "bbox": [grid.west, grid.south, grid.east, grid.north]},
            )
        lon, lat = grid.lon_lat(cell)
        elev = grid.elev[cell]
        cells.append(cell)
        points.append(
            RoutePointRead(
                lat=lat,
                lon=lon,
                elevation_m=None if elev != elev else round(elev, 2),  # NaN is NoData
                snapped_m=round(ta._mars_dist_m(p.lat, p.lon, lat, lon), 1),
            )
        )
    if cells[0] == cells[1]:
        raise AppError(422, "SAME_CELL", "Старт и финиш попадают в одну ячейку сетки рельефа.")

    wp_cells = []
    for idx, wp in enumerate(body.waypoints):
        c = grid.cell_of(wp.lat, wp.lon)
        if c is None:
            raise AppError(
                422,
                "OUTSIDE_COVERAGE",
                "Промежуточная научная точка вне сетки рельефа региона.",
                {"point": f"waypoint_{idx + 1}", "bbox": [grid.west, grid.south, grid.east, grid.north]},
            )
        wp_cells.append(c)

    targets = ops_repo.real_target_points(db, grid.west, grid.south, grid.east, grid.north)
    alternatives = route_planner.plan(
        grid,
        cells[0],
        cells[1],
        [m.value for m in body.modes],
        waypoints=wp_cells,
        weights={mode: w.model_dump(exclude_none=True) for mode, w in body.weights.items()},
        max_slope_deg=body.max_slope_deg,
        science_radius_m=body.science_radius_m,
        targets=targets,
        algorithm=body.algorithm,
    )

    warnings = []
    if grid.dy_m >= 100:
        warnings.append(
            f"Planned on {grid.dy_m:.0f} m MOLA cells: regional planning only, no EVA-scale obstacle is resolved."
        )
    nodata = sum(c == route_planner.UNKNOWN for c in grid.hclass)
    if nodata:
        warnings.append(
            f"{nodata} of {grid.rows * grid.cols} cells in the window have no elevation or derived terrain data; no route crosses them."
        )
    if not targets:
        warnings.append("No science targets are loaded for this window: SCIENCE_PRIORITY has nothing to prefer.")
    for alt in alternatives:
        if alt["status"] == "unreachable":
            warnings.append(f"{alt['mode']}: no route. {alt['reason']}")
            continue
        if alt["hazard"]["high_cells"]:
            warnings.append(f"{alt['mode']} crosses {alt['hazard']['high_cells']} HIGH-hazard cells.")
        if alt["data_quality"]["max_uncertainty"] > 0.5:
            warnings.append(
                f"{alt['mode']}: data uncertainty reaches {alt['data_quality']['max_uncertainty']:.2f} on part of the route "
                "(outside the high-resolution coverage)."
            )
    return RoutePlanRead(
        data_class="DERIVED",
        provenance_ids=sorted({*grid.provenance_ids, *(t["dataset_id"] for t in targets if t["dataset_id"])}),
        start=points[0],
        destination=points[1],
        grid={
            "rows": grid.rows,
            "cols": grid.cols,
            "cell_m": [round(grid.dx_m, 3), round(grid.dy_m, 3)],
            "step": body.step,
            "west": grid.west,
            "south": grid.south,
            "east": grid.east,
            "north": grid.north,
        },
        alternatives=alternatives,
        cost_model=route_planner.COST_MODEL,
        limitations=route_planner.LIMITATIONS,
        warnings=warnings,
    )


def create_simulation(db: Session, body: SimulationCreate) -> SimulationRead:
    if ops_repo.get_route(db, body.route_id) is None:
        raise AppError(404, "ROUTE_NOT_FOUND", f"Маршрут {body.route_id} не найден.")
    row = ops_repo.create_simulation(
        db,
        body.route_id,
        status=IntegrationStatus.NOT_INTEGRATED.value,
        assumptions=body.assumptions,
    )
    return SimulationRead.model_validate(row)


def create_report(db: Session, body: ReportCreate) -> ReportRead:
    if ops_repo.get_route(db, body.route_id) is None:
        raise AppError(404, "ROUTE_NOT_FOUND", f"Маршрут {body.route_id} не найден.")
    row = ops_repo.create_report(
        db,
        body.route_id,
        status=IntegrationStatus.NOT_INTEGRATED.value,
        meda_reference_sol=body.meda_reference_sol,
    )
    return ReportRead.model_validate(row)


def terrain_point(lat: float, lon: float) -> TerrainPointRead:
    if lon > 180:
        lon = lon - 360
    # Finest grid first: CTX DTM (20 m) where it reaches, MOLA (463 m) around it.
    sample = ctx_dtm.elevation_at(lon, lat) or mola.elevation_at(lon, lat)
    return TerrainPointRead(lat=lat, lon=lon, **sample)


def terrain_heightmap(west: float, south: float, east: float, north: float, step: int) -> TerrainGridRead:
    west, east = (v - 360 if v > 180 else v for v in (west, east))
    return TerrainGridRead(**ctx_dtm.grid(west, south, east, north, step))


def terrain_analysis(west: float, south: float, east: float, north: float, step: int) -> TerrainAnalysisRead:
    west, east = (v - 360 if v > 180 else v for v in (west, east))
    return TerrainAnalysisRead(**ta.analyze_window(west, south, east, north, step))


def terrain_export_geotiff(layer: str, west: float, south: float, east: float, north: float, step: int) -> bytes:
    west, east = (v - 360 if v > 180 else v for v in (west, east))
    return ta.export_geotiff(layer, west, south, east, north, step)


def terrain_regions() -> list[TerrainRegionRead]:
    return [TerrainRegionRead(**r) for r in landing.regions()]


def assess_landing(lat: float, lon: float, west: float, south: float, east: float, north: float, step: int) -> LandingAssessmentRead:
    west, east, lon = (v - 360 if v > 180 else v for v in (west, east, lon))
    return LandingAssessmentRead(**landing.assess(route_planner.terrain_grid(west, south, east, north, step), lat, lon))


def terrain_profile(start: MarsCoord, end: MarsCoord) -> TerrainProfileRead:
    return TerrainProfileRead(**ta.line_profile(start.lat, start.lon, end.lat, end.lon))


def terrain_slope(lat: float, lon: float) -> TerrainSlopePointRead:
    if lon > 180:
        lon = lon - 360
    return TerrainSlopePointRead(**ta.point_analysis(lat, lon))


def get_environment_summary(db: Session, sol: int | None) -> EnvironmentSummaryRead:
    return EnvironmentSummaryRead(**meda.sol_summary(db, sol))


def get_environment_registry(db: Session) -> EnvRegistryRead:
    return EnvRegistryRead(**environment.registry(db))


def get_environment_series(
    db: Session, station: str, parameter: str, sol: int | None, lmst_from: float, lmst_to: float, bin_minutes: int
) -> EnvSeriesRead:
    if station != environment.STATION:
        # Another station's weather is never served in place of the one that was asked for.
        raise AppError(404, "STATION_NOT_INTEGRATED", "Данные этой станции не загружены.", {"station": station})
    if lmst_from >= lmst_to:
        raise AppError(422, "EMPTY_TIME_RANGE", "Начало интервала должно быть раньше конца.")
    return EnvSeriesRead(**environment.series(db, parameter, sol, lmst_from, lmst_to, bin_minutes))
