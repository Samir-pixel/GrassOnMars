"""MOLA elevation connector tests.

Fixtures are real data saved on 2026-11-14 from the USGS file
https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif :
- mola_dem_directory.bin: its tag directory, the last 184 966 bytes of the 2.13 GB file;
- mola_jezero_window.tif: the Jezero window (154 x 129 cells) as stored by the connector.
The offline tests replay them through a stand-in server that mimics the real file layout;
everything outside the header, the directory and the window is zero filler, not data.
"""

import re
import shutil
import struct
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.errors import AppError
from app.integrations import geotiff, mola
from app.integrations.http import UpstreamError

FIXTURES = Path(__file__).parent / "fixtures"
DIRECTORY = (FIXTURES / "mola_dem_directory.bin").read_bytes()
SUBSET = (FIXTURES / "mola_jezero_window.tif").read_bytes()
FILE_SIZE = 2_125_771_142
DIRECTORY_OFFSET = FILE_SIZE - len(DIRECTORY)
FIRST_ROW_OFFSET, ROW_BYTES = 184_973, 92_160  # layout of the real file, from its directory
COL, ROW, WIDTH, HEIGHT = 32_896, 9_100, 154, 129
LANDING = {"lon": 77.45088572, "lat": 18.44462715}  # first Perseverance waypoint (sol 13)


def real_file_bytes(offset: int, length: int) -> bytes:
    out = bytearray(length)

    def put(at: int, data: bytes) -> None:
        low, high = max(at, offset), min(at + len(data), offset + length)
        if low < high:
            out[low - offset : high - offset] = data[low - at : high - at]

    put(0, b"II" + struct.pack("<HI", 42, DIRECTORY_OFFSET))
    put(DIRECTORY_OFFSET, DIRECTORY)
    for r in range(HEIGHT):
        put(FIRST_ROW_OFFSET + (ROW + r) * ROW_BYTES + COL * 2, SUBSET[8 + r * WIDTH * 2 : 8 + (r + 1) * WIDTH * 2])
    return bytes(out)


def usgs_client(etags=None) -> tuple[httpx.Client, list[tuple[int, int]]]:
    """Stand-in for the USGS server; records the (offset, length) of every range request."""
    seen: list[tuple[int, int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == mola.URL
        first, last = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers["Range"]).groups())
        last = min(last, FILE_SIZE - 1)
        seen.append((first, last - first + 1))
        return httpx.Response(
            206,
            content=real_file_bytes(first, last - first + 1),
            headers={
                "Content-Range": f"bytes {first}-{last}/{FILE_SIZE}",
                "ETag": next(etags) if etags else '"same"',
            },
        )

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


@pytest.fixture()
def acquired() -> None:
    path = mola.subset_path()
    path.parent.mkdir(parents=True)
    shutil.copy(FIXTURES / "mola_jezero_window.tif", path)


def test_acquires_only_the_region_window() -> None:
    client, seen = usgs_client()
    info = mola.acquire(client)
    assert info["window"] == {"col": COL, "row": ROW, "width": WIDTH, "height": HEIGHT}
    assert info["bbox"] == [77.0, 17.8984375, 78.203125, 18.90625]
    assert (info["min_elevation_m"], info["max_elevation_m"]) == (-2888, -566)
    assert info["source_size_bytes"] == FILE_SIZE
    assert len(seen) == 3  # header, directory at the end of the file, the window
    assert sum(length for _, length in seen) < FILE_SIZE / 100
    assert mola.subset_path().read_bytes() == SUBSET  # byte-identical to the real acquisition


def test_elevation_is_the_real_grid_value(acquired) -> None:
    sample = mola.elevation_at(**LANDING)
    assert sample["elevation_m"] == -2566.0  # rover localisation says -2569.91 m at this point
    assert sample["data_class"] == "REAL"
    assert sample["provenance_ids"] == ["mgs_mola_dem_463m"]
    assert (sample["pixel_lon"], sample["pixel_lat"]) == pytest.approx((77.44921875, 18.44140625), abs=1e-9)
    with pytest.raises(AppError) as err:
        mola.elevation_at(lon=79.0, lat=18.4)
    assert err.value.code == "OUTSIDE_COVERAGE"


def test_server_ignoring_range_is_refused_without_reading_the_body() -> None:
    class Unreadable(httpx.SyncByteStream):
        def __iter__(self):
            raise AssertionError("the 2 GB body must not be read")

    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, stream=Unreadable())

    with pytest.raises(UpstreamError) as err:
        mola.acquire(httpx.Client(transport=httpx.MockTransport(handler)))
    assert err.value.details["upstream_status"] == 200
    assert len(requests) == 1
    assert not mola.subset_path().exists()


def test_remote_file_changing_between_requests_is_refused() -> None:
    client, _ = usgs_client(etags=iter(['"v1"', '"v2"', '"v2"']))
    with pytest.raises(UpstreamError) as err:
        mola.acquire(client)
    assert err.value.code == "UPSTREAM_INVALID_DATA"
    assert not mola.subset_path().exists()


@pytest.mark.parametrize(
    "document",
    [
        b"<html><body>503 Service Unavailable</body></html>",
        SUBSET[:200],  # truncated
        # Compression tag 259 changed from 1 (none) to 5 (LZW)
        SUBSET.replace(struct.pack("<HHIHH", 259, 3, 1, 1, 0), struct.pack("<HHIHH", 259, 3, 1, 5, 0)),
        # GeoKey 3075 (projection) changed from 17 (equirectangular) to 1 (transverse Mercator)
        SUBSET.replace(struct.pack("<4H", 3075, 0, 1, 17), struct.pack("<4H", 3075, 0, 1, 1)),
    ],
    ids=["html", "truncated", "compressed", "other-projection"],
)
def test_rejects_unsupported_or_damaged_geotiff(document: bytes) -> None:
    assert document != SUBSET
    with pytest.raises(UpstreamError) as err:
        geotiff.open_geotiff(lambda offset, length: document[offset : offset + length], "test", "memory")
    assert err.value.code == "UPSTREAM_INVALID_DATA"


def test_ingest_writes_provenance_record() -> None:
    client, _ = usgs_client()
    with SessionLocal() as db:
        dataset = mola.ingest(db, client)
        assert dataset.data_class == "REAL"
        assert dataset.integration_status == "integrated"
        assert dataset.is_demonstration is False
        assert dataset.source_url == mola.URL
        assert dataset.retrieved_at is not None
        assert dataset.raster_uri.endswith("raw/mola/Mars_MGS_MOLA_DEM_mosaic_global_463m__jezero.tif")
        assert dataset.sha256_checksum == "4be592df9cf5ffba80ef02b739e0fe7210689b2dbb660c89c4e7c4e6df0eb4e9"
        assert dataset.native_crs_wkt.startswith("Equirectangular Mars|GCS Name = GCS_Mars")
        assert dataset.vertical_datum == "MOLA areoid (gravity model GMM-2B)"
        assert "CC0" in dataset.license_note
        assert dataset.observed_at_start is None  # the file states no observation dates
        assert dataset.extra_metadata["acquisition"]["source_etag"] == '"same"'
        assert [h["step"] for h in dataset.processing_history] == ["acquire_region_window"]
        db.rollback()  # the test leaves the database untouched


def test_terrain_point_endpoint(client: TestClient, acquired) -> None:
    response = client.get("/api/v1/terrain/point", params=LANDING)
    assert response.status_code == 200
    body = response.json()
    assert body["elevation_m"] == -2566.0
    assert body["data_class"] == "REAL"
    assert body["provenance_ids"] == ["mgs_mola_dem_463m"]

    outside = client.get("/api/v1/terrain/point", params={"lat": 0, "lon": 0})
    assert outside.status_code == 422
    assert outside.json()["error"]["code"] == "OUTSIDE_COVERAGE"


def test_terrain_point_before_acquisition(client: TestClient) -> None:
    response = client.get("/api/v1/terrain/point", params=LANDING)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATASET_NOT_ACQUIRED"


@pytest.mark.live
def test_live_single_cell_from_usgs() -> None:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        info = mola.acquire(client, region=(LANDING["lon"], LANDING["lat"], LANDING["lon"], LANDING["lat"]))
    assert info["window"] == {"col": 32953, "row": 9159, "width": 1, "height": 1}
    assert info["source_size_bytes"] == FILE_SIZE
    assert mola.elevation_at(**LANDING)["elevation_m"] == -2566.0
