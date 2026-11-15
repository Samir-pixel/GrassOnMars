"""MEDA connector tests.

Fixtures (tests/fixtures/meda/) are real PDS files of sol 100, downloaded on 2026-11-14 from
https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ :
- *.xml: the four PDS4 labels, unchanged;
- *.CSV: the header and the first 120 records of each table (the real tables are 2.8–8.2 MB).
The stand-in archive serves each excerpt with its real label in which four values (file size,
MD5, record count, stop time) are rewritten to describe the excerpt; directory pages are minimal
hand-written listings.
"""

import hashlib
import re
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.core.config import settings
from app.core.database import SessionLocal
from app.integrations import meda
from app.integrations.http import UpstreamError

FIXTURES = Path(__file__).parent / "fixtures" / "meda"
PS, RHS, WS, ATS = meda.PRODUCTS
STEMS = {
    "DER_PS": "WE__0100___________DER_PS__________________P01",
    "DER_RHS": "WE__0100___________DER_RHS_________________P02",
    "DER_WS": "WE__0100___________DER_WS__________________P02",
    "CAL_ATS": "WE__0100___________CAL_ATS_________________P01",
}


def real_label(sensor: str) -> bytes:
    return (FIXTURES / f"{STEMS[sensor]}.xml").read_bytes()


def excerpt(sensor: str) -> bytes:
    return (FIXTURES / f"{STEMS[sensor]}.CSV").read_bytes()


def excerpt_label(sensor: str, table: bytes | None = None) -> bytes:
    """The real label, rewritten to describe the excerpt instead of the full table."""
    table = table or excerpt(sensor)
    lines = table.decode().splitlines()
    start = re.search(rb"<start_date_time>([^<]+)<", real_label(sensor))[1].decode()
    span = float(lines[-1].split(",")[0]) - float(lines[1].split(",")[0])
    stop = (datetime.fromisoformat(start) + timedelta(seconds=span)).isoformat().replace("+00:00", "Z")
    xml = real_label(sensor)
    for tag, value in (
        ("file_size", len(table)),
        ("md5_checksum", hashlib.md5(table).hexdigest()),
        ("stop_date_time", stop),
    ):
        xml = re.sub(rf"(<{tag}[^>]*>)[^<]+".encode(), rf"\g<1>{value}".encode(), xml, count=1)
    return re.sub(rb"<records>\d+</records>", f"<records>{len(lines) - 1}</records>".encode(), xml)


def archive(tables: dict[str, bytes] | None = None) -> tuple[httpx.Client, list[str]]:
    """Stand-in for the PDS node: listings answer 200, files answer 206 to Range requests."""
    tables = tables or {}
    seen: list[str] = []

    def page(*names: str) -> httpx.Response:
        return httpx.Response(200, text="".join(f'<a href="{n}">{n}</a>\n' for n in ("/PDS/parent/", *names)))

    def handler(request: httpx.Request) -> httpx.Response:
        path = str(request.url).removeprefix(meda.BUNDLE_URL)
        seen.append(path)
        collection, _, rest = path.partition("/")
        if rest == "":
            return page("sol_0000_0089/", "sol_0090_0179/", "collection.xml")
        if rest == "sol_0090_0179/":
            return page("sol_0099/", "sol_0100/")
        if rest == "sol_0090_0179/sol_0100/":
            stems = [s for s in STEMS.values() if ("DER_" in s) == (collection == "data_derived_env")]
            older = [s[:-2] + "00" for s in stems]  # an earlier version that must not be picked
            return page(*(f"{s}{ext}" for s in older + stems for ext in (".CSV", ".xml")))
        sensor = next((k for k, s in STEMS.items() if rest == f"sol_0090_0179/sol_0100/{s}{Path(rest).suffix}"), None)
        if sensor is None:
            return httpx.Response(404)
        table = tables.get(sensor, excerpt(sensor))
        body = excerpt_label(sensor) if rest.endswith(".xml") else table
        first, last = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers["Range"]).groups())
        part = body[first : last + 1]
        return httpx.Response(206, content=part, headers={"Content-Range": f"bytes {first}-{first + len(part) - 1}/{len(body)}"})

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def test_parses_real_pds4_label() -> None:
    label = meda.parse_label(real_label("DER_PS"), "label.xml")
    assert label.lidvid == "urn:nasa:pds:mars2020_meda:data_derived_env:we__0100___________der_ps__________________p::1.0"
    assert label.file_name == "WE__0100___________DER_PS__________________P01.CSV"
    assert (label.file_size, label.records, label.fields) == (2764587, 51195, 6)
    assert label.md5 == "803fbdbdb34b1ea5b099139f406095fb"
    assert label.start.isoformat() == "2021-05-31T22:23:00.782000+00:00"
    assert label.processing_level == "Derived"


@pytest.mark.parametrize(
    "document",
    [
        b"<html>404</html>",
        b'<!DOCTYPE x [<!ENTITY a "b">]>' + real_label("DER_PS"),
        real_label("DER_PS").replace(b"<md5_checksum>803f", b"<md5_checksum>ZZZZ"),
        real_label("DER_PS").replace(b"P01.CSV</file_name>", b"/../../x.CSV</file_name>"),
        real_label("DER_PS").replace(b"<file_size unit=\"byte\">2764587", b"<file_size unit=\"byte\">99999999999"),
    ],
    ids=["html", "doctype", "bad-md5", "path-in-file-name", "huge-size"],
)
def test_rejects_invalid_label(document: bytes) -> None:
    assert document != real_label("DER_PS")
    with pytest.raises(UpstreamError) as err:
        meda.parse_label(document, "label.xml")
    assert err.value.code == "UPSTREAM_INVALID_DATA"


def test_parses_real_tables_and_keeps_gaps_as_none() -> None:
    pressure = meda.parse_table(excerpt("DER_PS"), meda.parse_label(excerpt_label("DER_PS"), "l"), PS, "t")
    assert pressure["PRESSURE"][:3] == [761.55, 761.52, 761.55]  # pascal, sol 100 just after local midnight
    assert pressure["LMST"][0] == "00100M00:00:00.560"
    assert len(pressure["SCLK"]) == 120

    wind = meda.parse_table(excerpt("DER_WS"), meda.parse_label(excerpt_label("DER_WS"), "l"), WS, "t")
    assert wind["HORIZONTAL_WIND_SPEED"][0] is None  # 999999999 in the file
    assert wind["WIND_DIRECTION"][0] is None

    air = meda.parse_table(excerpt("CAL_ATS"), meda.parse_label(excerpt_label("CAL_ATS"), "l"), ATS, "t")
    assert air["ATS_LOCAL_TEMP1"][0] == 202.98  # kelvin


def test_rejects_table_that_disagrees_with_its_label() -> None:
    label = meda.parse_label(excerpt_label("DER_PS"), "l")
    for table in (
        excerpt("DER_PS").rsplit(b"\n", 3)[0] + b"\n",  # records missing
        excerpt("DER_PS").replace(b"761.55", b"n/a", 1),
        excerpt("DER_WS"),  # another sensor's table
    ):
        with pytest.raises(UpstreamError) as err:
            meda.parse_table(table, label, PS, "t")
        assert err.value.code == "UPSTREAM_INVALID_DATA"


def test_acquire_picks_latest_version_verifies_md5_and_reuses_local_copy() -> None:
    client, seen = archive()
    info = meda.acquire(client, PS, 100, {})
    assert info["label_url"].endswith("sol_0090_0179/sol_0100/WE__0100___________DER_PS__________________P01.xml")
    assert info["md5"] == hashlib.md5(excerpt("DER_PS")).hexdigest()
    assert info["records"] == 120
    assert info["computed_by_marswalk"]["PRESSURE"]["records_with_value"] == 120
    stored = settings.data_dir / "raw" / "meda" / "data_derived_env" / "sol_0100" / "WE__0100___________DER_PS__________________P01.CSV"
    assert stored.read_bytes() == excerpt("DER_PS")
    assert len(seen) == 5  # three listings, the label, the table

    meda.acquire(client, PS, 100, {})
    assert sum(path.endswith(".CSV") for path in seen) == 1  # the verified local copy was reused


def test_corrupted_download_is_refused_and_not_stored() -> None:
    client, _ = archive({"DER_PS": excerpt("DER_PS").replace(b"761.55", b"761.56", 1)})
    with pytest.raises(UpstreamError) as err:
        meda.acquire(client, PS, 100, {})
    assert err.value.details["reason"] == "size or MD5 differs from the PDS4 label"
    assert not (settings.data_dir / "raw" / "meda").exists()


def test_sol_missing_from_archive_is_a_structured_404() -> None:
    client, _ = archive()
    for sol in (98, 5000):  # no directory for the sol; no range directory at all
        with pytest.raises(UpstreamError) as err:
            meda.acquire(client, PS, sol, {})
        assert (err.value.status_code, err.value.code) == (404, "MEDA_SOL_NOT_ARCHIVED")


def test_ingest_sol_writes_provenance_with_observation_dates() -> None:
    client, _ = archive()
    with SessionLocal() as db:
        derived, calibrated = meda.ingest_sol(db, client, 100)
        assert (derived.data_class, derived.integration_status, derived.processing_level) == ("REAL", "integrated", "Derived")
        assert {"sol_0100/DER_PS", "sol_0100/DER_RHS", "sol_0100/DER_WS"} <= set(derived.extra_metadata["products"])
        assert "sol_0100/CAL_ATS" in calibrated.extra_metadata["products"]
        assert derived.observed_at_start.isoformat() == "2021-05-31T22:23:00.782000+00:00"  # real UTC from the label
        assert derived.source_url == meda.BUNDLE_URL + "data_derived_env/"
        product = derived.extra_metadata["products"]["sol_0100/DER_PS"]
        assert product["lidvid"].endswith("der_ps__________________p::1.0")
        assert "cite data by DOI or LIDVID" in derived.license_note
        db.rollback()  # the test leaves the database untouched


@pytest.mark.live
def test_live_meda_label_from_pds() -> None:
    with httpx.Client(timeout=httpx.Timeout(40, connect=20), follow_redirects=True) as client:
        url = meda.locate(client, PS, 100, {})
        label = meda.parse_label(client.get(url).content, url)
    assert label.md5 == "803fbdbdb34b1ea5b099139f406095fb"
    assert label.records == 51195
