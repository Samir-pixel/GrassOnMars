"""Perseverance waypoint connector tests.

Fixture m20_waypoints_excerpt.json: six real features of NASA's M20_waypoints.json as downloaded
on 2026-11-14 (first two, last two, one mid-drive, one interpolated). Values are untouched; only
the per-feature image lists were emptied to keep the file small.
"""

import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.database import SessionLocal
from app.integrations import perseverance
from app.integrations.http import UpstreamError
from app.models.geo import ScientificTarget

EXCERPT = (Path(__file__).parent / "fixtures" / "m20_waypoints_excerpt.json").read_bytes()


def edited(change) -> bytes:
    doc = json.loads(EXCERPT)
    change(doc)
    return json.dumps(doc).encode()


def nasa_client(body: bytes = EXCERPT) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == perseverance.URL
        return httpx.Response(200, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_parses_real_waypoints() -> None:
    name, waypoints = perseverance.parse_waypoints(EXCERPT)
    assert name == "M20_waypoints_sol2022_all"
    assert [w.rmc for w in waypoints] == ["3_0", "3_110", "9_364", "26_2216", "92_130", "93_0"]
    first = waypoints[0]
    assert (first.sol, first.lon, first.lat, first.elevation_m) == (13, 77.45088572, 18.44462715, -2569.91)
    assert waypoints[3].note == "Interpolated"  # NASA's own flag is kept, not hidden
    assert waypoints[-1].distance_total_m == 45245.71


@pytest.mark.parametrize(
    "document",
    [
        b"<html>503</html>",
        b'{"type": "FeatureCollection", "features": []}',
        edited(lambda d: d["features"][1]["geometry"]["coordinates"].__setitem__(0, 137.4)),  # Gale, not Jezero
        edited(lambda d: d["features"][1]["properties"].__setitem__("RMC", "3_0")),  # duplicate position id
        edited(lambda d: d["features"][2]["properties"].__setitem__("sol", "340")),
        edited(lambda d: d["features"][2]["properties"].pop("elev_geoid")),
        edited(lambda d: d["features"][0]["geometry"].__setitem__("type", "LineString")),
    ],
    ids=["html", "empty", "outside-jezero", "duplicate-rmc", "sol-not-int", "no-elevation", "not-a-point"],
)
def test_rejects_invalid_waypoint_file(document: bytes) -> None:
    with pytest.raises(UpstreamError) as err:
        perseverance.parse_waypoints(document)
    assert err.value.code == "UPSTREAM_INVALID_DATA"


def test_ingest_replaces_targets_and_writes_provenance() -> None:
    def rows(db) -> int:
        return db.scalar(
            select(func.count()).select_from(ScientificTarget).where(ScientificTarget.dataset_id == perseverance.DATASET_ID)
        )

    with SessionLocal() as db:
        dataset = perseverance.ingest(db, nasa_client())
        assert rows(db) == 6
        perseverance.ingest(db, nasa_client())  # running again replaces, never duplicates
        assert rows(db) == 6

        assert (dataset.data_class, dataset.integration_status, dataset.is_demonstration) == ("REAL", "integrated", False)
        assert dataset.source_url == perseverance.URL
        assert len(dataset.sha256_checksum) == 64
        assert dataset.extra_metadata["sol_range"] == [13, 2022]
        assert dataset.known_limitations.startswith("1 из 6 точек NASA помечает как интерполированные")
        assert (settings.data_dir / "raw" / "m2020" / "M20_waypoints.json").read_bytes() == EXCERPT

        landing = db.get(ScientificTarget, "m2020_wp_3_0")
        assert (landing.category, landing.rover_sol, landing.elevation_m) == ("rover_waypoint", 13, -2569.91)
        assert landing.is_demonstration is False
        assert "интерполировано NASA" in db.get(ScientificTarget, "m2020_wp_26_2216").description_ru
        db.rollback()  # the test leaves the database untouched


def test_invalid_file_changes_nothing() -> None:
    with SessionLocal() as db:
        with pytest.raises(UpstreamError):
            perseverance.ingest(db, nasa_client(b"<html>maintenance</html>"))
        assert not (settings.data_dir / "raw" / "m2020").exists()
        assert not db.new and not db.dirty


@pytest.mark.live
def test_live_waypoints_from_nasa() -> None:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        data = client.get(perseverance.URL).content
    _, waypoints = perseverance.parse_waypoints(data)
    assert len(waypoints) >= 708
    assert (waypoints[0].rmc, waypoints[0].sol, waypoints[0].elevation_m) == ("3_0", 13, -2569.91)
