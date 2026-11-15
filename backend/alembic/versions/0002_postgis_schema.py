"""PostGIS geospatial schema (Stage 4).

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-14

Drops the Stage-3 interim tables and creates the full PostGIS schema.
Raster pixels stay on disk (raster_uri); only metadata and geometries live here.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MARS_SRID = 949900
MARS_METRIC_SRID = 949918
GLOBAL = (-180.0, -90.0, 180.0, 90.0)
JEZERO = (77.0, 17.8, 78.2, 18.9)
DEMO_ROUTE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _bbox_polygon(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    return (
        f"ST_SetSRID(ST_MakeEnvelope({min_lon}, {min_lat}, {max_lon}, {max_lat}), {MARS_SRID})"
    )


def _point(lon: float, lat: float) -> str:
    return f"ST_SetSRID(ST_MakePoint({lon}, {lat}), {MARS_SRID})"


def _linestring(coords: list[tuple[float, float]]) -> str:
    pts = ", ".join(f"{lon} {lat}" for lon, lat in coords)
    return f"ST_SetSRID(ST_GeomFromText('LINESTRING({pts})'), {MARS_SRID})"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.execute(
        f"""
        INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
        VALUES (
          {MARS_SRID},
          'IAU_2015',
          49900,
          '+proj=longlat +R=3396190 +no_defs',
          'GEOGCS["Mars 2000",DATUM["D_Mars_2000",SPHEROID["Mars_2000_IAU_IAG",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]]'
        )
        ON CONFLICT (srid) DO UPDATE SET
          auth_name = EXCLUDED.auth_name,
          auth_srid = EXCLUDED.auth_srid,
          proj4text = EXCLUDED.proj4text,
          srtext = EXCLUDED.srtext
        """
    )
    op.execute(
        f"""
        INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
        VALUES (
          {MARS_METRIC_SRID},
          'MARSWALK',
          {MARS_METRIC_SRID},
          '+proj=eqc +lat_ts=18.38 +lat_0=0 +lon_0=77.58 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs',
          'PROJCS["Mars_2000_Jezero_Equidistant_Cylindrical",GEOGCS["Mars 2000",DATUM["D_Mars_2000",SPHEROID["Mars_2000_IAU_IAG",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Equidistant_Cylindrical"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",77.58],PARAMETER["Standard_Parallel_1",18.38],UNIT["Meter",1.0]]'
        )
        ON CONFLICT (srid) DO UPDATE SET
          auth_name = EXCLUDED.auth_name,
          auth_srid = EXCLUDED.auth_srid,
          proj4text = EXCLUDED.proj4text,
          srtext = EXCLUDED.srtext
        """
    )

    for table in (
        "reports",
        "simulations",
        "targets",
        "routes",
        "layers",
        "datasets",
        "missions",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    op.create_table(
        "missions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("agency", sa.String(), nullable=False),
        sa.Column("launch_date", sa.Date(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
        sa.Column("url", sa.Text()),
    )
    op.create_table(
        "instruments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("mission_id", sa.String(), sa.ForeignKey("missions.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("acronym", sa.String(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
    )
    op.create_index("ix_instruments_mission_id", "instruments", ["mission_id"])

    op.create_table(
        "datasets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("mission_id", sa.String(), sa.ForeignKey("missions.id")),
        sa.Column("instrument_id", sa.String(), sa.ForeignKey("instruments.id")),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("product_id", sa.String()),
        sa.Column("doi", sa.String()),
        sa.Column("data_class", sa.String(), nullable=False),
        sa.Column("observed_at_start", sa.DateTime(timezone=True)),
        sa.Column("observed_at_end", sa.DateTime(timezone=True)),
        sa.Column("retrieved_at", sa.DateTime(timezone=True)),
        sa.Column("processing_level", sa.String()),
        sa.Column("spatial_resolution_m", sa.Float()),
        sa.Column("native_crs_wkt", sa.Text()),
        sa.Column("working_srid", sa.Integer(), nullable=False, server_default=str(MARS_SRID)),
        sa.Column("vertical_datum", sa.Text()),
        sa.Column("source_archive", sa.Text()),
        sa.Column("source_url", sa.Text()),
        sa.Column("raster_uri", sa.Text()),
        sa.Column("sha256_checksum", sa.String()),
        sa.Column(
            "processing_history",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("known_limitations", sa.Text()),
        sa.Column("license_note", sa.Text()),
        sa.Column("integration_status", sa.String(), nullable=False),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("metadata", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("footprint", Geometry("POLYGON", srid=MARS_SRID)),
        sa.CheckConstraint(
            "data_class IN ('MEASURED','DERIVED','SIMULATED','ASSUMPTION')",
            name="ck_datasets_data_class",
        ),
        sa.CheckConstraint(
            "integration_status IN ('not_integrated','integrated','unavailable')",
            name="ck_datasets_integration_status",
        ),
    )
    op.create_index("ix_datasets_mission_id", "datasets", ["mission_id"])
    op.create_index("ix_datasets_instrument_id", "datasets", ["instrument_id"])
    op.execute("CREATE INDEX ix_datasets_footprint ON datasets USING GIST (footprint)")

    op.create_table(
        "dataset_lineage",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column(
            "parent_dataset_id",
            sa.String(),
            sa.ForeignKey("datasets.id"),
            nullable=False,
        ),
        sa.UniqueConstraint("dataset_id", "parent_dataset_id"),
    )
    op.create_index("ix_dataset_lineage_dataset_id", "dataset_lineage", ["dataset_id"])
    op.create_index(
        "ix_dataset_lineage_parent_dataset_id",
        "dataset_lineage",
        ["parent_dataset_id"],
    )

    op.create_table(
        "map_layers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("title_ru", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("z_index", sa.Integer(), nullable=False),
        sa.Column(
            "visible_by_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("legend_spec", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_map_layers_dataset_id", "map_layers", ["dataset_id"])

    op.create_table(
        "observations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("source_record_id", sa.String()),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("geom", Geometry("POINT", srid=MARS_SRID), nullable=False),
        sa.Column("values", JSONB(), nullable=False),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_observations_dataset_id", "observations", ["dataset_id"])
    op.create_index("ix_observations_observed_at", "observations", ["observed_at"])
    op.execute("CREATE INDEX ix_observations_geom ON observations USING GIST (geom)")

    op.create_table(
        "scientific_targets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
        sa.Column("geom", Geometry("GEOMETRY", srid=MARS_SRID), nullable=False),
        sa.Column("elevation_m", sa.Float()),
        sa.Column("rover_sol", sa.Integer()),
        sa.Column("source_identifier", sa.String()),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_scientific_targets_dataset_id", "scientific_targets", ["dataset_id"])
    op.create_index("ix_scientific_targets_category", "scientific_targets", ["category"])
    op.execute("CREATE INDEX ix_scientific_targets_geom ON scientific_targets USING GIST (geom)")

    op.create_table(
        "hazard_features",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id")),
        sa.Column("hazard_class", sa.String(), nullable=False),
        sa.Column("title_ru", sa.String(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
        sa.Column("geom", Geometry("GEOMETRY", srid=MARS_SRID), nullable=False),
        sa.Column("factors", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_hazard_features_dataset_id", "hazard_features", ["dataset_id"])
    op.create_index("ix_hazard_features_hazard_class", "hazard_features", ["hazard_class"])
    op.execute("CREATE INDEX ix_hazard_features_geom ON hazard_features USING GIST (geom)")

    op.create_table(
        "routes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("profile", sa.String()),
        sa.Column("waypoints", JSONB(), nullable=False),
        sa.Column("geom", Geometry("LINESTRING", srid=MARS_SRID)),
        sa.Column("metrics", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "provenance_ids",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute("CREATE INDEX ix_routes_geom ON routes USING GIST (geom)")

    op.create_table(
        "route_segments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("geom", Geometry("LINESTRING", srid=MARS_SRID), nullable=False),
        sa.Column("length_m", sa.Float()),
        sa.Column("max_slope_deg", sa.Float()),
        sa.Column("hazard_class", sa.String()),
        sa.Column("metrics", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.UniqueConstraint("route_id", "seq"),
    )
    op.create_index("ix_route_segments_route_id", "route_segments", ["route_id"])
    op.execute("CREATE INDEX ix_route_segments_geom ON route_segments USING GIST (geom)")

    op.create_table(
        "simulations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("assumptions", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "timeline_events",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_simulations_route_id", "simulations", ["route_id"])

    op.create_table(
        "mission_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("meda_reference_sol", sa.Integer()),
        sa.Column("snapshot", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "is_demonstration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_mission_reports_route_id", "mission_reports", ["route_id"])

    _seed_catalogue()
    _seed_demonstration_spatial()


def _seed_catalogue() -> None:
    conn = op.get_bind()
    missions = [
        (
            "mgs",
            "Mars Global Surveyor",
            "NASA / JPL",
            date(1996, 11, 7),
            "Орбитальный аппарат NASA. Лазерный альтиметр MOLA построил глобальную модель высот Марса.",
            "https://science.nasa.gov/mission/mars-global-surveyor/",
        ),
        (
            "odyssey",
            "2001 Mars Odyssey",
            "NASA / JPL",
            date(2001, 4, 7),
            "Орбитальный аппарат NASA. Камера THEMIS снимает поверхность в тепловом ИК.",
            "https://science.nasa.gov/mission/odyssey/",
        ),
        (
            "mro",
            "Mars Reconnaissance Orbiter",
            "NASA / JPL",
            date(2005, 8, 12),
            "Орбитальный аппарат NASA. Камеры CTX и HiRISE дают снимки и DTM кратера Езеро.",
            "https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
        ),
        (
            "mars2020",
            "Mars 2020 Perseverance",
            "NASA / JPL",
            date(2020, 7, 30),
            "Марсоход Perseverance в кратере Езеро. Метеостанция MEDA измеряет атмосферу в точке ровера.",
            "https://science.nasa.gov/mission/mars-2020-perseverance/",
        ),
    ]
    for row in missions:
        conn.execute(
            sa.text(
                "INSERT INTO missions (id, name, agency, launch_date, description_ru, url) "
                "VALUES (:id, :name, :agency, :launch_date, :description_ru, :url)"
            ),
            {
                "id": row[0],
                "name": row[1],
                "agency": row[2],
                "launch_date": row[3],
                "description_ru": row[4],
                "url": row[5],
            },
        )

    instruments = [
        ("mola", "mgs", "Mars Orbiter Laser Altimeter", "MOLA", "Глобальная лазерная альтиметрия."),
        ("themis", "odyssey", "Thermal Emission Imaging System", "THEMIS", "Тепловой ИК-имиджер."),
        ("ctx", "mro", "Context Camera", "CTX", "Контекстная камера ~6 м/пиксель."),
        (
            "hirise",
            "mro",
            "High Resolution Imaging Science Experiment",
            "HiRISE",
            "Высокое разрешение ~0.3 м/пиксель.",
        ),
        ("meda", "mars2020", "Mars Environmental Dynamics Analyzer", "MEDA", "Метеостанция Perseverance."),
    ]
    for row in instruments:
        conn.execute(
            sa.text(
                "INSERT INTO instruments (id, mission_id, name, acronym, description_ru) "
                "VALUES (:id, :mission_id, :name, :acronym, :description_ru)"
            ),
            {
                "id": row[0],
                "mission_id": row[1],
                "name": row[2],
                "acronym": row[3],
                "description_ru": row[4],
            },
        )

    def dataset(**kwargs: Any) -> None:
        footprint_sql = kwargs.pop("footprint_sql")
        kwargs.setdefault("working_srid", MARS_SRID)
        kwargs.setdefault("integration_status", "not_integrated")
        kwargs.setdefault("is_demonstration", False)
        kwargs.setdefault("processing_history", json.dumps([]))
        if "metadata" not in kwargs:
            kwargs["metadata"] = json.dumps(
                {"note_ru": "Продукт ещё не скачан; CRS уточняется на этапе 5."}
            )
        elif isinstance(kwargs["metadata"], dict):
            kwargs["metadata"] = json.dumps(kwargs["metadata"], ensure_ascii=False)
        cols = ", ".join(kwargs.keys()) + ", footprint"
        binds = ", ".join(f":{k}" for k in kwargs.keys()) + f", {footprint_sql}"
        conn.execute(sa.text(f"INSERT INTO datasets ({cols}) VALUES ({binds})"), kwargs)

    dataset(
        id="mgs_mola_shaded_relief_463m",
        title="MOLA Color Shaded Relief, global (Mars Trek WMTS)",
        mission_id="mgs",
        instrument_id="mola",
        provider="NASA Mars Trek",
        data_class="MEASURED",
        spatial_resolution_m=463.0,
        source_archive="NASA Mars Trek",
        source_url=(
            "https://trek.nasa.gov/tiles/Mars/EQ/"
            "Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml"
        ),
        vertical_datum="Mars_2000_Areoid",
        footprint_sql=_bbox_polygon(*GLOBAL),
    )
    dataset(
        id="mro_ctx_dtm_jezero_20m",
        title="Mars 2020 TRN CTX DTM Mosaic (Jezero)",
        mission_id="mro",
        instrument_id="ctx",
        provider="USGS Astrogeology",
        data_class="MEASURED",
        spatial_resolution_m=20.0,
        source_archive="USGS Astrogeology",
        raster_uri="data/processed/mro_ctx_dtm_jezero_20m.tif",
        vertical_datum="Mars_2000_Areoid",
        known_limitations="Файл ещё не загружен; raster_uri — целевой путь COG.",
        footprint_sql=_bbox_polygon(*JEZERO),
    )
    dataset(
        id="mro_hirise_dtm_jezero_1m",
        title="Mars 2020 TRN HiRISE DTM Mosaic (Jezero)",
        mission_id="mro",
        instrument_id="hirise",
        provider="USGS Astrogeology",
        data_class="MEASURED",
        spatial_resolution_m=1.0,
        source_archive="USGS Astrogeology",
        source_url=(
            "https://astrogeology.usgs.gov/search/map/"
            "mars_2020_terrain_relative_navigation_hirise_dtm_mosaic"
        ),
        raster_uri="data/processed/mro_hirise_dtm_jezero_1m.tif",
        vertical_datum="Mars_2000_Areoid",
        footprint_sql=_bbox_polygon(77.3, 18.3, 77.6, 18.6),
    )
    dataset(
        id="usgs_sim3464_geologic_map",
        title="Geologic Map of Jezero Crater (USGS SIM 3464)",
        mission_id="mro",
        instrument_id=None,
        provider="USGS",
        data_class="DERIVED",
        source_archive="USGS Publications",
        source_url="https://pubs.usgs.gov/sim/3464/",
        product_id="SIM 3464",
        footprint_sql=_bbox_polygon(*JEZERO),
        metadata={"citation": "Sun and Stack, 2020", "note_ru": "Интерпретация, не прямое измерение."},
    )
    dataset(
        id="m2020_meda_calibrated",
        title="MEDA calibrated and derived data (PDS4)",
        mission_id="mars2020",
        instrument_id="meda",
        provider="NASA PDS Atmospheres Node",
        data_class="MEASURED",
        source_archive="NASA PDS Atmospheres",
        footprint_sql=_bbox_polygon(77.4, 18.4, 77.5, 18.5),
        known_limitations="Точечные измерения у ровера; ветер неполный.",
    )
    dataset(
        id="demo_jezero_planning_context",
        title="DEMONSTRATION DATA — Jezero planning context (synthetic vectors only)",
        mission_id=None,
        instrument_id=None,
        provider="MARSWALK",
        data_class="ASSUMPTION",
        integration_status="integrated",
        is_demonstration=True,
        source_archive="MARSWALK Stage 4 seed",
        known_limitations="Не NASA. Только для проверки PostGIS-запросов.",
        footprint_sql=_bbox_polygon(*JEZERO),
        metadata={
            "label": "DEMONSTRATION DATA",
            "note_ru": "Синтетические точки/полигоны для тестов БД, не научные наблюдения.",
        },
    )

    layers = [
        ("mola_shaded_relief", "mgs_mola_shaded_relief_463m", "MOLA затенённый рельеф", "wmts", 10, True),
        ("ctx_dtm_jezero", "mro_ctx_dtm_jezero_20m", "CTX DTM Езеро (20 м)", "cog_raster", 20, False),
        ("geology_sim3464", "usgs_sim3464_geologic_map", "Геология USGS SIM 3464", "vector_geojson", 40, False),
    ]
    for row in layers:
        conn.execute(
            sa.text(
                "INSERT INTO map_layers "
                "(id, dataset_id, title_ru, kind, z_index, visible_by_default, legend_spec) "
                "VALUES (:id, :dataset_id, :title_ru, :kind, :z_index, :visible, '{}'::jsonb)"
            ),
            {
                "id": row[0],
                "dataset_id": row[1],
                "title_ru": row[2],
                "kind": row[3],
                "z_index": row[4],
                "visible": row[5],
            },
        )


def _seed_demonstration_spatial() -> None:
    conn = op.get_bind()
    demo_ds = "demo_jezero_planning_context"
    landing = (77.4508, 18.4447)
    delta = (77.48, 18.50)
    scarp = (77.46, 18.47)

    targets = [
        (
            "demo_octavia_e_butler_landing",
            "DEMONSTRATION: Octavia E. Butler Landing (approx.)",
            "rover_waypoint",
            "Синтетическая точка рядом с местом посадки Perseverance. DEMONSTRATION DATA.",
            landing,
            -2560.0,
            0,
        ),
        (
            "demo_western_delta_outcrop",
            "DEMONSTRATION: Western delta outcrop",
            "geology",
            "Синтетическая цель на западной дельте. DEMONSTRATION DATA.",
            delta,
            None,
            None,
        ),
        (
            "demo_delta_scarp_sample",
            "DEMONSTRATION: Delta scarp sample site",
            "geology",
            "Синтетическая точка у обрыва дельты. DEMONSTRATION DATA.",
            scarp,
            None,
            None,
        ),
    ]
    for t in targets:
        lon, lat = t[4]
        conn.execute(
            sa.text(
                "INSERT INTO scientific_targets "
                "(id, dataset_id, name, category, description_ru, geom, elevation_m, rover_sol, "
                "source_identifier, is_demonstration) "
                f"VALUES (:id, :dataset_id, :name, :category, :description_ru, {_point(lon, lat)}, "
                ":elevation_m, :rover_sol, :source_identifier, true)"
            ),
            {
                "id": t[0],
                "dataset_id": demo_ds,
                "name": t[1],
                "category": t[2],
                "description_ru": t[3],
                "elevation_m": t[5],
                "rover_sol": t[6],
                "source_identifier": "DEMONSTRATION DATA",
            },
        )

    conn.execute(
        sa.text(
            "INSERT INTO hazard_features "
            "(id, dataset_id, hazard_class, title_ru, description_ru, geom, factors, is_demonstration) "
            "VALUES ("
            ":id, :dataset_id, 'no_go', "
            "'DEMONSTRATION: крутой обрыв', "
            "'Синтетический полигон опасности для проверки ST_DWithin / ST_Intersects. DEMONSTRATION DATA.', "
            f"{_bbox_polygon(77.455, 18.465, 77.465, 18.475)}, "
            "CAST(:factors AS jsonb), true)"
        ),
        {
            "id": str(uuid.uuid4()),
            "dataset_id": demo_ds,
            "factors": json.dumps(
                {"slope_deg_assumed": 35, "label": "DEMONSTRATION DATA"},
                ensure_ascii=False,
            ),
        },
    )

    conn.execute(
        sa.text(
            "INSERT INTO observations "
            "(id, dataset_id, source_record_id, observed_at, geom, values, is_demonstration) "
            "VALUES ("
            ":id, :dataset_id, 'DEMONSTRATION-SOL-0', :observed_at, "
            f"{_point(*landing)}, CAST(:values AS jsonb), true)"
        ),
        {
            "id": str(uuid.uuid4()),
            "dataset_id": demo_ds,
            "observed_at": datetime(2021, 2, 18, 12, 0, tzinfo=timezone.utc),
            "values": json.dumps(
                {
                    "pressure_pa": None,
                    "air_temp_k": None,
                    "note": "DEMONSTRATION DATA — not a MEDA measurement",
                }
            ),
        },
    )

    route_coords = [landing, scarp, delta]
    waypoints = [{"lat": lat, "lon": lon} for lon, lat in route_coords]
    conn.execute(
        sa.text(
            "INSERT INTO routes "
            "(id, status, profile, waypoints, geom, metrics, provenance_ids, is_demonstration) "
            "VALUES ("
            "CAST(:id AS uuid), 'not_integrated', 'demo_shortest', CAST(:waypoints AS jsonb), "
            f"{_linestring(route_coords)}, "
            "CAST(:metrics AS jsonb), CAST(:provenance AS jsonb), true)"
        ),
        {
            "id": DEMO_ROUTE_ID,
            "waypoints": json.dumps(waypoints),
            "metrics": json.dumps({"label": "DEMONSTRATION DATA"}),
            "provenance": json.dumps(["demo_jezero_planning_context"]),
        },
    )
    conn.execute(
        sa.text(
            "INSERT INTO route_segments "
            "(id, route_id, seq, geom, length_m, max_slope_deg, hazard_class, metrics) "
            "VALUES ("
            ":id, CAST(:route_id AS uuid), 1, "
            f"{_linestring([landing, scarp])}, 1500, 12, 'caution', "
            "CAST(:metrics AS jsonb))"
        ),
        {
            "id": str(uuid.uuid4()),
            "route_id": DEMO_ROUTE_ID,
            "metrics": json.dumps({"label": "DEMONSTRATION DATA"}),
        },
    )


def downgrade() -> None:
    for table in (
        "mission_reports",
        "simulations",
        "route_segments",
        "routes",
        "hazard_features",
        "scientific_targets",
        "observations",
        "map_layers",
        "dataset_lineage",
        "datasets",
        "instruments",
        "missions",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
