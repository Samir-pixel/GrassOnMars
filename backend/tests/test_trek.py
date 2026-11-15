"""Mars Trek connector tests.

Fixtures are real Trek responses saved on 2026-11-14 (capabilities + catalogue record of the
MOLA colour hillshade layer). Tile bytes in the offline tests are stand-ins for transport
mechanics only; the `live` tests fetch real tiles.
"""

import os
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.integrations import trek
from app.integrations.http import UpstreamError
from app.models.geo import MapLayer

FIXTURES = Path(__file__).parent / "fixtures"
CAPS = (FIXTURES / "trek_mola_capabilities.xml").read_bytes()
CATALOG = (FIXTURES / "trek_catalog_mola.json").read_bytes()
LAYER_ID = "Mars_MGS_MOLA_ClrShade_merge_global_463m"
CAPS_URL = trek.capabilities_url(LAYER_ID)
JPEG_STUB = b"\xff\xd8\xff\xe0 stand-in tile bytes"


def make_client(handler) -> tuple[httpx.Client, list[str]]:
    """Mock transport plus the list of URLs that actually reached the 'network'."""
    seen: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return handler(request)

    return httpx.Client(transport=httpx.MockTransport(record)), seen


def trek_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if url == CAPS_URL:
        return httpx.Response(200, content=CAPS)
    if url == trek.CATALOG_URL:
        return httpx.Response(200, content=CATALOG)
    if url.endswith("/0/0/0.jpg"):
        return httpx.Response(200, content=JPEG_STUB)
    return httpx.Response(404)


def test_parses_real_capabilities() -> None:
    layer = trek.parse_capabilities(CAPS, CAPS_URL)
    assert layer.identifier == LAYER_ID
    assert layer.crs == "urn:ogc:def:crs:EPSG::104905"  # native CRS label kept verbatim
    assert layer.media_type == "image/jpeg"
    assert layer.bbox == (-180.0, -89.9991635, 179.9983271, 90.0)
    assert [m.identifier for m in layer.matrices] == [str(z) for z in range(8)]
    assert (layer.matrices[0].matrix_width, layer.matrices[0].matrix_height) == (2, 1)  # "2.0" in XML
    # Matches the sample tile URL published in Trek's own API config (no "1.0.0//").
    assert trek.tile_url(layer, 0, 0, 0) == (
        "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m"
        "/1.0.0/default/default028mm/0/0/0.jpg"
    )
    # Mars pixel size from the grid; the document's ScaleDenominator would give Earth's 78 km.
    assert trek.resolution_m(layer.matrices[0]) == pytest.approx(41677.0, abs=1.0)
    assert trek.resolution_m(layer.matrices[7]) == pytest.approx(325.6, abs=0.1)


@pytest.mark.parametrize(
    "document",
    [
        b"<html><body>404 Not Found</body></html>",
        b"not xml at all",
        b'<!DOCTYPE x [<!ENTITY a "b">]>' + CAPS,
        CAPS.replace(b"https://trek.nasa.gov/tiles", b"https://evil.example/tiles"),
        CAPS.replace(b"<Format>image/jpeg</Format>", b"<Format>image/tiff</Format>"),
        CAPS.replace(b"<ows:LowerCorner>-180.0", b"<ows:LowerCorner>-999.0"),
    ],
)
def test_rejects_invalid_capabilities(document: bytes) -> None:
    with pytest.raises(UpstreamError) as err:
        trek.parse_capabilities(document, CAPS_URL)
    assert err.value.code == "UPSTREAM_INVALID_DATA"
    assert err.value.details["source"] == "NASA Mars Trek"


def test_tile_is_cached_on_disk() -> None:
    client, seen = make_client(trek_handler)
    layer, _ = trek.get_capabilities(LAYER_ID, client)
    assert trek.get_tile(layer, 0, 0, 0, client) == JPEG_STUB
    assert trek.get_tile(layer, 0, 0, 0, client) == JPEG_STUB
    assert trek.get_capabilities(LAYER_ID, client)[0] == layer
    assert len(seen) == 2  # capabilities once, tile once


def test_missing_tile_is_reported_and_remembered() -> None:
    client, seen = make_client(trek_handler)
    layer, _ = trek.get_capabilities(LAYER_ID, client)
    for _ in range(2):
        with pytest.raises(UpstreamError) as err:
            trek.get_tile(layer, 0, 0, 1, client)  # inside the matrix, upstream answers 404
        assert (err.value.status_code, err.value.code) == (404, "TILE_NOT_FOUND")
    assert seen.count(trek.tile_url(layer, 0, 0, 1)) == 1

    before = len(seen)
    with pytest.raises(UpstreamError) as err:
        trek.get_tile(layer, 0, 5, 0, client)  # level 0 has a single row
    assert err.value.code == "TILE_NOT_FOUND"
    assert len(seen) == before  # rejected without a request


def test_regional_layer_tiles_outside_coverage_never_reach_nasa() -> None:
    """Real capabilities of the CTX Jezero orthomosaic: a regional layer on the global tile grid."""
    name = "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0"
    layer = trek.parse_capabilities(
        (FIXTURES / "trek_ctx_jezero_capabilities.xml").read_bytes(), trek.capabilities_url(name)
    )
    assert layer.bbox == (77.1604655, 18.2110274, 77.6991776, 18.7211945)
    assert [m.identifier for m in layer.matrices] == [str(z) for z in range(14)]
    assert trek.resolution_m(layer.matrices[13]) == pytest.approx(5.09, abs=0.01)

    client, seen = make_client(lambda request: httpx.Response(200, content=b"\x89PNG stand-in tile bytes"))
    trek.get_tile(layer, 13, 3256, 11716, client)  # the tile holding the Perseverance landing site
    assert seen == [f"https://trek.nasa.gov/tiles/Mars/EQ/{name}/1.0.0/default/default028mm/13/3256/11716.png"]
    for z, row, col in ((13, 3000, 11716), (13, 3256, 0), (5, 0, 0)):
        with pytest.raises(UpstreamError) as err:
            trek.get_tile(layer, z, row, col, client)
        assert err.value.code == "TILE_NOT_FOUND"
    assert len(seen) == 1


def test_non_image_tile_is_rejected_and_not_cached() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == CAPS_URL:
            return httpx.Response(200, content=CAPS)
        return httpx.Response(200, content=b"<html>maintenance</html>")

    client, seen = make_client(handler)
    layer, _ = trek.get_capabilities(LAYER_ID, client)
    for _ in range(2):
        with pytest.raises(UpstreamError) as err:
            trek.get_tile(layer, 0, 0, 0, client)
        assert err.value.code == "UPSTREAM_INVALID_DATA"
    assert len(seen) == 3  # asked again: the bad body never reached the cache


def test_network_failure_is_retried_then_structured() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection reset", request=request)

    client, seen = make_client(handler)
    with pytest.raises(UpstreamError) as err:
        trek.get_capabilities(LAYER_ID, client)
    assert (err.value.status_code, err.value.code) == (502, "UPSTREAM_UNAVAILABLE")
    assert err.value.details["url"] == CAPS_URL
    assert len(seen) == 3


def test_timeout_maps_to_504() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    client, _ = make_client(handler)
    with pytest.raises(UpstreamError) as err:
        trek.get_capabilities(LAYER_ID, client)
    assert (err.value.status_code, err.value.code) == (504, "UPSTREAM_TIMEOUT")


def test_rate_limit_waits_retry_after(monkeypatch) -> None:
    waits: list[float] = []
    monkeypatch.setattr("app.integrations.http.time.sleep", waits.append)
    answers = iter([httpx.Response(429, headers={"Retry-After": "2"}), httpx.Response(200, content=CAPS)])
    client, seen = make_client(lambda request: next(answers))
    layer, _ = trek.get_capabilities(LAYER_ID, client)
    assert layer.identifier == LAYER_ID
    assert waits == [2.0]
    assert len(seen) == 2


def test_stale_capabilities_survive_an_outage() -> None:
    client, _ = make_client(trek_handler)
    trek.get_capabilities(LAYER_ID, client)
    cached = settings.data_dir / "raw" / "trek" / LAYER_ID / "WMTSCapabilities.xml"
    old = time.time() - 3 * 24 * 3600
    os.utime(cached, (old, old))

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    offline, seen = make_client(down)
    layer, _ = trek.get_capabilities(LAYER_ID, offline)
    assert layer.identifier == LAYER_ID
    assert len(seen) == 3  # tried the network first, then fell back


def test_ingest_writes_provenance_record() -> None:
    client, _ = make_client(trek_handler)
    spec = trek.LAYERS[0]
    with SessionLocal() as db:
        dataset = trek.ingest_layer(db, spec, client)
        layer = db.get(MapLayer, spec.layer_id)
        assert dataset.data_class == "REAL"
        assert dataset.integration_status == "integrated"
        assert dataset.is_demonstration is False
        assert dataset.provider == "NASA Mars Trek"
        assert dataset.product_id == LAYER_ID
        assert dataset.source_url == CAPS_URL
        assert dataset.retrieved_at is not None
        assert len(dataset.sha256_checksum) == 64
        assert dataset.native_crs_wkt == "urn:ogc:def:crs:EPSG::104905"
        assert "NASA must be acknowledged" in dataset.license_note
        assert dataset.observed_at_start is None  # the service reports no observation dates
        assert dataset.extra_metadata["trek"]["mission"] == "Mars Global Surveyor"
        assert dataset.extra_metadata["trek"]["product_created_at"] == "2020-06-25T22:51:06Z"
        assert [h["step"] for h in dataset.processing_history] == ["ingest_trek_wmts"]
        assert layer.kind == "wmts"
        assert layer.service["crs"] == "urn:ogc:def:crs:EPSG::104905"
        assert (layer.service["min_zoom"], layer.service["max_zoom"]) == (0, 7)
        assert layer.service["tile_url"] == "/api/v1/tiles/mola_shaded_relief/{z}/{row}/{col}"
        assert layer.service["attribution"] == "NASA Mars Trek · Mars Global Surveyor MOLA"
        trek.ingest_layer(db, spec, client)  # re-ingest keeps a single history entry
        assert len(dataset.processing_history) == 1
        db.rollback()  # the test leaves the database untouched


def test_tile_endpoint_unknown_layer(client: TestClient) -> None:
    response = client.get("/api/v1/tiles/no_such_layer/0/0/0")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LAYER_NOT_FOUND"


@pytest.mark.live
def test_live_trek_capabilities_and_tile() -> None:
    client = httpx.Client(timeout=30, follow_redirects=True)
    layer, _ = trek.get_capabilities(LAYER_ID, client)
    assert layer.crs == "urn:ogc:def:crs:EPSG::104905"
    tile = trek.get_tile(layer, 0, 0, 0, client)
    assert tile.startswith(b"\xff\xd8\xff") and len(tile) > 10_000
    assert trek.get_catalog_record(LAYER_ID, client)["instrument"] == "MOLA"
