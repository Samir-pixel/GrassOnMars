"""Initial schema: missions, datasets, layers, routes; mission and planned-dataset registry rows.

Revision ID: 0001
Revises:
Create Date: 2026-11-14
"""
from datetime import date
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None

GLOBAL = [-180.0, -90.0, 180.0, 90.0]
URL_OK = "Адрес ответил HTTP 200 14.11.2026; продукт не скачан и не проверен."
URL_UNKNOWN = "Адрес источника не подтверждён; уточняется на этапе 5."


def _dataset(
    id: str,
    title: str,
    mission_id: str | None,
    instrument: str | None,
    provider: str,
    data_class: str = "MEASURED",
    resolution_m: float | None = None,
    source_url: str | None = None,
    coverage_bbox: list[float] | None = None,
    **metadata: Any,
) -> dict[str, Any]:
    # Nothing is downloaded yet: observation dates, CRS and processing level stay empty
    # until Stage 5 reads them from the real product.
    return {
        "id": id,
        "title": title,
        "mission_id": mission_id,
        "instrument": instrument,
        "provider": provider,
        "data_class": data_class,
        "observed_at_start": None,
        "observed_at_end": None,
        "coverage_bbox": coverage_bbox,
        "spatial_resolution_m": resolution_m,
        "crs": None,
        "processing_level": None,
        "source_url": source_url,
        "integration_status": "not_integrated",
        "metadata": {"verification": URL_OK if source_url else URL_UNKNOWN, **metadata},
    }


def upgrade() -> None:
    missions = op.create_table(
        "missions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("agency", sa.String(), nullable=False),
        sa.Column("launch_date", sa.Date(), nullable=False),
        sa.Column("instruments", JSONB(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
        sa.Column("url", sa.Text()),
    )
    datasets = op.create_table(
        "datasets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("mission_id", sa.String(), sa.ForeignKey("missions.id")),
        sa.Column("instrument", sa.String()),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("data_class", sa.String(), nullable=False),
        sa.Column("observed_at_start", sa.DateTime(timezone=True)),
        sa.Column("observed_at_end", sa.DateTime(timezone=True)),
        sa.Column("coverage_bbox", JSONB()),
        sa.Column("spatial_resolution_m", sa.Float()),
        sa.Column("crs", sa.Text()),
        sa.Column("processing_level", sa.String()),
        sa.Column("source_url", sa.Text()),
        sa.Column("integration_status", sa.String(), nullable=False),
        sa.Column("metadata", JSONB(), nullable=False),
    )
    layers = op.create_table(
        "layers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("title_ru", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("z_index", sa.Integer(), nullable=False),
        sa.Column("visible_by_default", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "routes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("points", JSONB(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
    )
    op.create_table(
        "targets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description_ru", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id")),
        sa.Column("elevation_m", sa.Float()),
        sa.Column("rover_sol", sa.Integer()),
    )
    op.create_table(
        "simulations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("route_id", sa.Uuid(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("assumptions", JSONB(), nullable=False),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("route_id", sa.Uuid(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("meda_reference_sol", sa.Integer()),
    )

    op.bulk_insert(
        missions,
        [
            {
                "id": "mgs",
                "name": "Mars Global Surveyor",
                "agency": "NASA / JPL",
                "launch_date": date(1996, 11, 7),
                "instruments": ["MOLA"],
                "description_ru": (
                    "Орбитальный аппарат NASA. Лазерный альтиметр MOLA построил глобальную модель "
                    "высот Марса; к ней привязаны остальные модели рельефа."
                ),
                "url": "https://science.nasa.gov/mission/mars-global-surveyor/",
            },
            {
                "id": "odyssey",
                "name": "2001 Mars Odyssey",
                "agency": "NASA / JPL",
                "launch_date": date(2001, 4, 7),
                "instruments": ["THEMIS"],
                "description_ru": (
                    "Орбитальный аппарат NASA. Камера THEMIS снимает поверхность в тепловом "
                    "инфракрасном диапазоне днём и ночью."
                ),
                "url": "https://science.nasa.gov/mission/odyssey/",
            },
            {
                "id": "mro",
                "name": "Mars Reconnaissance Orbiter",
                "agency": "NASA / JPL",
                "launch_date": date(2005, 8, 12),
                "instruments": ["CTX", "HiRISE"],
                "description_ru": (
                    "Орбитальный аппарат NASA. Камеры CTX (около 6 м/пиксель) и HiRISE "
                    "(около 0,3 м/пиксель) дают снимки и стереомодели рельефа кратера Езеро."
                ),
                "url": "https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
            },
            {
                "id": "mars2020",
                "name": "Mars 2020 Perseverance",
                "agency": "NASA / JPL",
                "launch_date": date(2020, 7, 30),
                "instruments": ["MEDA"],
                "description_ru": (
                    "Марсоход Perseverance совершил посадку в кратере Езеро 18 февраля 2021 года. "
                    "Метеостанция MEDA измеряет давление, температуру, влажность и ветер в точке, "
                    "где находится марсоход."
                ),
                "url": "https://science.nasa.gov/mission/mars-2020-perseverance/",
            },
        ],
    )
    op.bulk_insert(
        datasets,
        [
            _dataset(
                "mgs_mola_shaded_relief_463m",
                "MOLA Color Shaded Relief, global (Mars Trek WMTS)",
                "mgs",
                "MOLA",
                "NASA Mars Trek",
                resolution_m=463.0,
                source_url=(
                    "https://trek.nasa.gov/tiles/Mars/EQ/"
                    "Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml"
                ),
                coverage_bbox=GLOBAL,
            ),
            _dataset(
                "mgs_mola_megdr_dem_463m",
                "MOLA MEGDR global DEM",
                "mgs",
                "MOLA",
                "USGS Astrogeology / NASA PDS",
                resolution_m=463.0,
                coverage_bbox=GLOBAL,
            ),
            _dataset(
                "mro_ctx_dtm_jezero_20m",
                "Mars 2020 Terrain Relative Navigation CTX DTM Mosaic (Jezero)",
                "mro",
                "CTX",
                "USGS Astrogeology",
                resolution_m=20.0,
            ),
            _dataset(
                "mro_hirise_dtm_jezero_1m",
                "Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic (Jezero)",
                "mro",
                "HiRISE",
                "USGS Astrogeology",
                resolution_m=1.0,
                source_url=(
                    "https://astrogeology.usgs.gov/search/map/"
                    "mars_2020_terrain_relative_navigation_hirise_dtm_mosaic"
                ),
            ),
            _dataset(
                "mro_ctx_ortho_jezero",
                "Mars 2020 Terrain Relative Navigation CTX Orthomosaic (Jezero)",
                "mro",
                "CTX",
                "USGS Astrogeology",
                note_ru="Разрешение около 6 м/пиксель, уточняется на этапе 5.",
            ),
            _dataset(
                "mro_hirise_ortho_jezero",
                "Mars 2020 Terrain Relative Navigation HiRISE Orthomosaic (Jezero)",
                "mro",
                "HiRISE",
                "USGS Astrogeology",
                note_ru="Разрешение около 0,25 м/пиксель, уточняется на этапе 5.",
            ),
            _dataset(
                "odyssey_themis_day_ir_100m",
                "THEMIS Day IR global mosaic",
                "odyssey",
                "THEMIS",
                "USGS / ASU (NASA Mars Trek)",
                resolution_m=100.0,
                coverage_bbox=GLOBAL,
            ),
            _dataset(
                "odyssey_themis_night_ir_100m",
                "THEMIS Night IR global mosaic",
                "odyssey",
                "THEMIS",
                "USGS / ASU (NASA Mars Trek)",
                resolution_m=100.0,
                coverage_bbox=GLOBAL,
            ),
            _dataset(
                "usgs_sim3464_geologic_map",
                "Geologic Map of Jezero Crater and the Nili Planum Region, Mars (USGS SIM 3464)",
                "mro",
                None,
                "USGS",
                data_class="DERIVED",
                source_url="https://pubs.usgs.gov/sim/3464/",
                citation="Sun and Stack, 2020",
                map_scale="1:75,000",
                note_ru="Геологическая интерпретация USGS по данным MRO, не прямое измерение.",
            ),
            _dataset(
                "m2020_meda_calibrated",
                "MEDA calibrated and derived data (PDS4)",
                "mars2020",
                "MEDA",
                "NASA PDS Atmospheres Node",
                note_ru="Точечные измерения в месте нахождения марсохода.",
            ),
            _dataset(
                "m2020_rover_traverse",
                "Perseverance traverse path",
                "mars2020",
                None,
                "NASA / JPL (mission map feed)",
                source_url="https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json",
                note_ru="Недокументированный адрес: может измениться, нужна локальная копия.",
            ),
            _dataset(
                "iau_nomenclature_mars",
                "Gazetteer of Planetary Nomenclature (Mars)",
                None,
                None,
                "IAU / USGS",
                note_ru="Справочник утверждённых названий, не данные миссии.",
            ),
        ],
    )
    op.bulk_insert(
        layers,
        [
            {
                "id": "mola_shaded_relief",
                "dataset_id": "mgs_mola_shaded_relief_463m",
                "title_ru": "MOLA затенённый рельеф",
                "kind": "wmts",
                "z_index": 10,
                "visible_by_default": True,
            },
            {
                "id": "ctx_ortho_jezero",
                "dataset_id": "mro_ctx_ortho_jezero",
                "title_ru": "CTX ортомозаика Езеро",
                "kind": "cog_raster",
                "z_index": 20,
                "visible_by_default": False,
            },
            {
                "id": "themis_night_ir",
                "dataset_id": "odyssey_themis_night_ir_100m",
                "title_ru": "THEMIS ночной ИК",
                "kind": "wmts",
                "z_index": 30,
                "visible_by_default": False,
            },
            {
                "id": "geology_sim3464",
                "dataset_id": "usgs_sim3464_geologic_map",
                "title_ru": "Геология USGS SIM 3464",
                "kind": "vector_geojson",
                "z_index": 40,
                "visible_by_default": False,
            },
            {
                "id": "perseverance_traverse",
                "dataset_id": "m2020_rover_traverse",
                "title_ru": "Маршрут Perseverance",
                "kind": "vector_geojson",
                "z_index": 50,
                "visible_by_default": True,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("reports")
    op.drop_table("simulations")
    op.drop_table("targets")
    op.drop_table("routes")
    op.drop_table("layers")
    op.drop_table("datasets")
    op.drop_table("missions")
