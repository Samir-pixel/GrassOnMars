"""NASA Mars Trek WMTS connector.

Official API description: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars
Trek publishes one RESTful WMTS capabilities document per layer. Its tiles are 8-bit pictures
(JPEG/PNG): map backgrounds, never a source of elevation or temperature values.
Findings behind the quirks handled here: docs/NASA_DATA_SOURCES.md.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.http import UpstreamError, fetch, shared_client, write_atomic
from app.models.geo import Dataset, MapLayer
from app.repositories.datasets import upsert_real_dataset

SOURCE = "NASA Mars Trek"
TILE_ROOT = "https://trek.nasa.gov/tiles/Mars/EQ"
# The layer catalogue the official API page itself queries (equirectangular layers).
CATALOG_URL = (
    "https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647"
    "&facetKeys=itemType%7CproductCat2%7CserviceTypes%7CthumbnailURLDir"
    "&facetValues=product%7C-%28DEM%20ConfidenceRaw%20Slope%29%7CMosaic%7C%5B%2A%20TO%20%2A%5D"
)
LICENSE_NOTE = (
    "NASA material is generally not subject to copyright in the United States; NASA must be "
    "acknowledged as the source and no endorsement implied "
    "(https://www.nasa.gov/nasa-brand-center/images-and-media/)."
)
MARS_RADIUS_M = 3396190.0
CACHE_TTL_S = 24 * 3600
MAX_CAPABILITIES_BYTES = 2_000_000
# media type -> (file signature, cache extension)
TILE_FORMATS = {"image/jpeg": (b"\xff\xd8\xff", "jpg"), "image/png": (b"\x89PNG", "png")}
PLACEHOLDERS = ("{Style}", "{TileMatrixSet}", "{TileMatrix}", "{TileRow}", "{TileCol}")
# Trek's global CTX and HiRISE mosaics publish tiles on Esri OnMars. Only that prefix is accepted.
ONMARS_PREFIX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/"
NS = {"wmts": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,120}$")  # identifiers become URL and cache path parts


@dataclass(frozen=True)
class TileMatrix:
    identifier: str
    matrix_width: int
    matrix_height: int
    tile_width: int
    tile_height: int


@dataclass(frozen=True)
class WmtsLayer:
    identifier: str
    title: str
    crs: str  # declared by the service, kept verbatim
    tile_matrix_set: str
    style: str
    media_type: str
    template: str
    bbox: tuple[float, float, float, float]  # min_lon, min_lat, max_lon, max_lat (degrees)
    matrices: tuple[TileMatrix, ...]


@dataclass(frozen=True)
class TrekLayerSpec:
    identifier: str  # Trek productLabel, taken from the catalogue
    dataset_id: str
    layer_id: str
    title_ru: str
    mission_id: str
    instrument_id: str
    resolution_m: float  # product resolution from the publisher's page, not the tile pyramid
    z_index: int
    visible_by_default: bool
    limitations_ru: str


IMAGE_ONLY_RU = "Сервис не сообщает даты наблюдений исходных снимков."
THERMAL_PICTURE_RU = (
    "Яркость мозаики показывает относительное тепловое излучение поверхности; это не калиброванная "
    "температура, числовые значения по ней получать нельзя. Охват — от 65° ю. ш. до 65° с. ш. "
)

# One spec per layer; names come from the Trek catalogue, never guessed.
LAYERS = (
    TrekLayerSpec(
        identifier="Mars_MGS_MOLA_ClrShade_merge_global_463m",
        dataset_id="mgs_mola_shaded_relief_463m",
        layer_id="mola_shaded_relief",
        title_ru="MOLA затенённый рельеф",
        mission_id="mgs",
        instrument_id="mola",
        resolution_m=463.0835744,
        z_index=10,
        visible_by_default=True,
        limitations_ru="8-битная мозаика для отображения: значения высот по ней получать нельзя. " + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0",
        dataset_id="mro_ctx_ortho_jezero_6m",
        layer_id="ctx_ortho_jezero",
        title_ru="CTX ортомозаика Езеро, 6 м",
        mission_id="mro",
        instrument_id="ctx",
        resolution_m=6.0,
        z_index=20,
        visible_by_default=False,
        limitations_ru="Тайлы самого детального уровня — 5,1 м на пиксель при 6 м у исходной мозаики. " + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
        dataset_id="mro_hirise_ortho_jezero_25cm",
        layer_id="hirise_ortho_jezero",
        title_ru="HiRISE ортомозаика Езеро, 25 см",
        mission_id="mro",
        instrument_id="hirise",
        resolution_m=0.25,
        z_index=30,
        visible_by_default=False,
        limitations_ru="Тайлы самого детального уровня — 0,32 м на пиксель при 0,25 м у исходной мозаики. " + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018",
        dataset_id="odyssey_themis_day_ir_100m",
        layer_id="themis_day_ir",
        title_ru="THEMIS дневная ИК-мозаика, 100 м",
        mission_id="odyssey",
        instrument_id="themis",
        resolution_m=100.0,
        z_index=15,
        visible_by_default=False,
        limitations_ru=THERMAL_PICTURE_RU + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="CTX_beta01_uncontrolled_5m_Caltech",
        dataset_id="mro_ctx_murray_global_5m",
        layer_id="ctx_global",
        title_ru="CTX глобальная мозаика, 5 м",
        mission_id="mro",
        instrument_id="ctx",
        resolution_m=5.0,
        z_index=18,
        visible_by_default=False,
        limitations_ru="Неконтролируемая глобальная мозаика Murray Lab, около 5 м/пиксель. Не заменяет контролируемую мозаику Езеро. " + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="HiRISE_Global",
        dataset_id="mro_hirise_global_uncontrolled",
        layer_id="hirise_global",
        title_ru="HiRISE глобальная мозаика",
        mission_id="mro",
        instrument_id="hirise",
        resolution_m=0.3,
        z_index=28,
        visible_by_default=False,
        limitations_ru="Только там, где есть снимок HiRISE: остальное прозрачно. Неконтролируемая мозаика. " + IMAGE_ONLY_RU,
    ),
    TrekLayerSpec(
        identifier="THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018",
        dataset_id="odyssey_themis_night_ir_100m",
        layer_id="themis_night_ir",
        title_ru="THEMIS ночная ИК-мозаика, 100 м",
        mission_id="odyssey",
        instrument_id="themis",
        resolution_m=100.0,
        z_index=16,
        visible_by_default=False,
        limitations_ru=THERMAL_PICTURE_RU + IMAGE_ONLY_RU,
    ),
)


def _invalid(url: str, reason: str) -> UpstreamError:
    return UpstreamError(
        502,
        "UPSTREAM_INVALID_DATA",
        f"{SOURCE}: получены некорректные данные.",
        SOURCE,
        url,
        reason=reason,
    )


def _tile_not_found(url: str, reason: str) -> UpstreamError:
    return UpstreamError(
        404, "TILE_NOT_FOUND", f"{SOURCE}: тайл отсутствует.", SOURCE, url, reason=reason
    )


def capabilities_url(identifier: str) -> str:
    return f"{TILE_ROOT}/{identifier}/1.0.0/WMTSCapabilities.xml"


def parse_capabilities(xml: bytes, url: str) -> WmtsLayer:
    """Parse and validate one Trek capabilities document (one layer, one tile matrix set)."""
    if len(xml) > MAX_CAPABILITIES_BYTES or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise _invalid(url, "not a plain WMTS capabilities document")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise _invalid(url, f"XML parse error: {exc}") from exc
    layer = root.find("wmts:Contents/wmts:Layer", NS)
    matrix_set = root.find("wmts:Contents/wmts:TileMatrixSet", NS)
    if layer is None or matrix_set is None:
        raise _invalid(url, "no Layer or TileMatrixSet")

    def text(node: ET.Element, path: str) -> str:
        found = node.find(path, NS)
        if found is None or not (found.text or "").strip():
            raise _invalid(url, f"missing {path}")
        return found.text.strip()  # type: ignore[union-attr]

    try:
        lower = [float(v) for v in text(layer, "ows:BoundingBox/ows:LowerCorner").split()]
        upper = [float(v) for v in text(layer, "ows:BoundingBox/ows:UpperCorner").split()]
        matrices = tuple(
            TileMatrix(
                identifier=text(m, "ows:Identifier"),
                # Trek writes matrix sizes as "2.0"
                matrix_width=int(float(text(m, "wmts:MatrixWidth"))),
                matrix_height=int(float(text(m, "wmts:MatrixHeight"))),
                tile_width=int(text(m, "wmts:TileWidth")),
                tile_height=int(text(m, "wmts:TileHeight")),
            )
            for m in matrix_set.findall("wmts:TileMatrix", NS)
        )
        corners = {
            tuple(float(v) for v in text(m, "wmts:TopLeftCorner").split())
            for m in matrix_set.findall("wmts:TileMatrix", NS)
        }
    except ValueError as exc:
        raise _invalid(url, f"non-numeric value: {exc}") from exc

    resource = layer.find("wmts:ResourceURL", NS)
    result = WmtsLayer(
        identifier=text(layer, "ows:Identifier"),
        title=text(layer, "ows:Title"),
        crs=text(matrix_set, "ows:SupportedCRS"),
        tile_matrix_set=text(matrix_set, "ows:Identifier"),
        style=text(layer, "wmts:Style/ows:Identifier"),
        media_type=text(layer, "wmts:Format"),
        template=resource.get("template", "") if resource is not None else "",
        bbox=(lower[0], lower[1], upper[0], upper[1]) if len(lower) == len(upper) == 2 else (0, 0, 0, 0),
        matrices=matrices,
    )

    min_lon, min_lat, max_lon, max_lat = result.bbox
    problems = [
        reason
        for ok, reason in (
            (all(_SAFE_ID.match(v) for v in (result.identifier, result.style, result.tile_matrix_set)), "unsafe identifier"),
            (result.media_type in TILE_FORMATS, f"unsupported tile format {result.media_type}"),
            (bool(matrices), "no tile matrices"),
            (corners == {(-180.0, 90.0)}, "tile grid does not start at 180°W 90°N"),
            (all(m.identifier.isdigit() and min(m.matrix_width, m.matrix_height, m.tile_width, m.tile_height) > 0 for m in matrices), "bad tile matrix"),
            (-180 <= min_lon < max_lon <= 180 and -90 <= min_lat < max_lat <= 90, "bounding box outside Mars lon/lat range"),
            # Trek hosts most mosaics. The global CTX and HiRISE ones name Esri OnMars in the capabilities Trek itself publishes.
            (_template_ok(result.template), "unexpected tile URL template"),
        )
        if not ok
    ]
    if problems:
        raise _invalid(url, "; ".join(problems))
    return result


def _template_ok(template: str) -> bool:
    if template.startswith("https://trek.nasa.gov/"):
        return all(p in template for p in PLACEHOLDERS)
    if template.startswith(ONMARS_PREFIX):
        return all(p in template for p in ("{TileMatrix}", "{TileRow}", "{TileCol}"))
    return False


def tile_url(layer: WmtsLayer, z: int, row: int, col: int) -> str:
    url = (
        layer.template.replace("{Style}", layer.style)
        .replace("{TileMatrixSet}", layer.tile_matrix_set)
        .replace("{TileMatrix}", str(z))
        .replace("{TileRow}", str(row))
        .replace("{TileCol}", str(col))
    )
    return re.sub(r"(?<!:)/{2,}", "/", url)  # Trek templates contain "1.0.0//"


def resolution_m(matrix: TileMatrix) -> float:
    """Ground size of one pixel at the equator, from the grid itself.

    Trek's ScaleDenominator is computed with Earth's radius, so it is not used.
    """
    degrees_per_pixel = 360.0 / (matrix.matrix_width * matrix.tile_width)
    return degrees_per_pixel * math.pi * MARS_RADIUS_M / 180.0


def _cache_root() -> Path:
    return settings.data_dir / "raw" / "trek"


def _fresh(path: Path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL_S


def _cached[T](
    client: httpx.Client, url: str, path: Path, parse: Callable[[bytes], T]
) -> tuple[T, bytes]:
    """Use the network when the cached copy is older than a day; a stale copy beats no service."""
    if not _fresh(path):
        try:
            data = fetch(client, SOURCE, url).content
            parsed = parse(data)  # validated before it reaches the cache
            write_atomic(path, data)
            return parsed, data
        except UpstreamError:
            if not path.exists():
                raise
    data = path.read_bytes()
    return parse(data), data


def get_capabilities(identifier: str, client: httpx.Client) -> tuple[WmtsLayer, bytes]:
    url = capabilities_url(identifier)
    if not _SAFE_ID.match(identifier):
        raise _invalid(url, "unsafe identifier")
    path = _cache_root() / identifier / "WMTSCapabilities.xml"
    return _cached(client, url, path, lambda xml: parse_capabilities(xml, url))


def get_catalog_record(identifier: str, client: httpx.Client) -> dict[str, Any]:
    """Trek's own metadata for a layer: mission, instrument, native projection WKT, dates."""

    def parse(data: bytes) -> dict[str, Any]:
        try:
            docs = json.loads(data)["response"]["docs"]
            return next(d for d in docs if d["productLabel"] == identifier)
        except StopIteration:
            raise UpstreamError(
                404,
                "UPSTREAM_NOT_FOUND",
                f"{SOURCE}: слой отсутствует в каталоге.",
                SOURCE,
                CATALOG_URL,
                identifier=identifier,
            ) from None
        except (ValueError, KeyError, TypeError) as exc:
            raise _invalid(CATALOG_URL, f"unexpected catalogue structure: {exc!r}") from exc

    return _cached(client, CATALOG_URL, _cache_root() / "catalog_eq.json", parse)[0]


def get_tile(layer: WmtsLayer, z: int, row: int, col: int, client: httpx.Client) -> bytes:
    """One tile, from the disk cache when possible. Missing tiles are remembered for a day."""
    url = tile_url(layer, z, row, col)
    matrix = next((m for m in layer.matrices if m.identifier == str(z)), None)
    if matrix is None or not (0 <= row < matrix.matrix_height and 0 <= col < matrix.matrix_width):
        raise _tile_not_found(url, "outside the layer's tile matrix")
    span_lon, span_lat = 360.0 / matrix.matrix_width, 180.0 / matrix.matrix_height
    min_lon, min_lat, max_lon, max_lat = layer.bbox
    if (
        (col + 1) * span_lon - 180 <= min_lon
        or col * span_lon - 180 >= max_lon
        or 90 - row * span_lat <= min_lat
        or 90 - (row + 1) * span_lat >= max_lat
    ):
        raise _tile_not_found(url, "outside the layer's coverage")
    signature, extension = TILE_FORMATS[layer.media_type]
    # shortcut: the tile cache has no size cap, add eviction if it outgrows the disk budget
    path = _cache_root() / layer.identifier / str(z) / str(row) / f"{col}.{extension}"
    if path.exists():
        return path.read_bytes()
    missing = path.with_suffix(".missing")
    if _fresh(missing):
        raise _tile_not_found(url, "upstream has no such tile (cached)")
    try:
        data = fetch(client, SOURCE, url).content
    except UpstreamError as exc:
        if exc.status_code != 404:
            raise
        write_atomic(missing, b"")
        raise _tile_not_found(url, "upstream has no such tile") from exc
    if not data.startswith(signature):
        raise _invalid(url, f"tile is not {layer.media_type}")
    write_atomic(path, data)
    return data


def ingest_layer(db: Session, spec: TrekLayerSpec, client: httpx.Client) -> Dataset:
    """Register one Trek layer: dataset provenance record plus its map layer. Caller commits."""
    layer, xml = get_capabilities(spec.identifier, client)
    record = get_catalog_record(spec.identifier, client)
    source_url = capabilities_url(spec.identifier)
    checksum = hashlib.sha256(xml).hexdigest()
    min_lon, min_lat, max_lon, max_lat = layer.bbox
    deepest = max(layer.matrices, key=lambda m: int(m.identifier))
    mission, instrument = record.get("mission", ""), record.get("instrument", "")

    dataset = upsert_real_dataset(
        db,
        spec.dataset_id,
        step={"step": "ingest_trek_wmts", "capabilities_url": source_url, "capabilities_sha256": checksum},
        metadata={
            "trek": {
                "declared_crs": layer.crs,
                "catalog_uuid": record.get("item_UUID"),
                "mission": mission,
                "instrument": instrument,
                "coverage": record.get("coverage"),
                "product_created_at": record.get("data_created_date"),
                "description": record.get("description"),
            }
        },
        bbox=layer.bbox,
        title=f"{record.get('title', layer.title)} (Mars Trek WMTS)",
        mission_id=spec.mission_id,
        instrument_id=spec.instrument_id,
        provider=SOURCE,
        product_id=layer.identifier,
        spatial_resolution_m=spec.resolution_m,
        native_crs_wkt=record.get("projection"),
        source_archive=SOURCE,
        source_url=source_url,
        sha256_checksum=checksum,
        license_note=LICENSE_NOTE,
        known_limitations=spec.limitations_ru,
    )

    map_layer = db.get(MapLayer, spec.layer_id) or MapLayer(id=spec.layer_id)
    map_layer.dataset_id = spec.dataset_id
    map_layer.title_ru = spec.title_ru
    map_layer.kind = "wmts"
    map_layer.z_index = spec.z_index
    map_layer.visible_by_default = spec.visible_by_default
    map_layer.legend_spec = map_layer.legend_spec or {}
    map_layer.service = {
        "type": "wmts",
        "identifier": layer.identifier,
        "tile_url": f"/api/v1/tiles/{spec.layer_id}/{{z}}/{{row}}/{{col}}",
        "upstream_template": layer.template,
        "capabilities_url": source_url,
        "crs": layer.crs,
        "tile_matrix_set": layer.tile_matrix_set,
        "media_type": layer.media_type,
        "tile_size": deepest.tile_width,
        "min_zoom": min(int(m.identifier) for m in layer.matrices),
        "max_zoom": int(deepest.identifier),
        "max_zoom_resolution_m": round(resolution_m(deepest), 2),
        "bbox": [min_lon, min_lat, max_lon, max_lat],
        "attribution": " · ".join(p for p in (SOURCE, f"{mission} {instrument}".strip()) if p),
    }
    db.add(map_layer)
    db.flush()
    return dataset


def ingest_all(db: Session) -> list[str]:
    client = shared_client()
    ids = [ingest_layer(db, spec, client).id for spec in LAYERS]
    db.commit()
    return ids


if __name__ == "__main__":  # python -m app.integrations.trek
    from app.core.database import SessionLocal

    with SessionLocal() as session:
        print("ingested:", ", ".join(ingest_all(session)))
