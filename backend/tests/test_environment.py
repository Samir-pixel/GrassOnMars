"""Environmental monitoring tests. The MEDA tables are the real sol-100 excerpts of tests/fixtures/meda
(see test_meda.py): 120 records each, about two minutes of pressure and one minute of air temperature
after local midnight; every wind record of the excerpt carries the sensor's fill value."""

from statistics import mean

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.errors import AppError
from app.integrations import environment, meda
from app.models.geo import Dataset
from app.schemas.environment import EnvRegistryRead, EnvSeriesRead
from tests.test_meda import archive, excerpt


@pytest.fixture()
def db():
    """A session in which sol 100 of the fixtures is the only ingested sol. Nothing is committed."""
    client, _ = archive()
    with SessionLocal() as session:
        for dataset_id in meda.DATASETS:
            row = session.get(Dataset, dataset_id)
            if row:
                row.extra_metadata = {}
        meda.ingest_sol(session, client, 100)
        yield session
        session.rollback()


def column(sensor: str, *names: str) -> list[tuple[str, list[float]]]:
    """(LMST, values of the named columns) for every record of an excerpt, read independently of the module."""
    header, *rows = (line.split(",") for line in excerpt(sensor).decode().splitlines())
    return [(row[1], [float(row[header.index(n)]) for n in names]) for row in rows]


def test_pressure_is_binned_by_local_time_with_its_provenance(db) -> None:
    series = environment.series(db, "pressure", 100, bin_minutes=1)
    EnvSeriesRead(**series)
    first_minute = [v[0] for lmst, v in column("DER_PS", "PRESSURE") if lmst.startswith("00100M00:00:")]
    assert [p["lmst_h"] for p in series["points"]] == [0.0, round(1 / 60, 4)]
    first, second = series["points"]
    assert (first["value"], first["min"], first["max"]) == (round(mean(first_minute), 2), min(first_minute), max(first_minute))
    assert (first["samples"], first["valid_share"]) == (len(first_minute), 1.0)
    assert first["samples"] + second["samples"] == 120
    assert first["time_utc"] == "2021-05-31T22:23:00.782000+00:00"  # the label's start: UTC of the first record
    assert second["time_utc"].startswith("2021-05-31T22:24:0")

    assert (series["unit"], series["kind"], series["data_class"]) == ("Pa", "PROCESSED_OBSERVATION", "DERIVED")
    assert (series["mission"], series["instrument"]) == ("Mars 2020 Perseverance", "MEDA PS (pressure sensor)")
    assert series["source_dataset"] == "m2020_meda_derived" and series["available_sols"] == [100]
    assert series["product"]["lidvid"].endswith("der_ps__________________p::1.0")
    assert series["location"] is None or series["location"]["waypoint_sol"] <= 100  # where the rover stood

    later = environment.series(db, "pressure", 100, lmst_from=1 / 60, bin_minutes=1)
    assert [p["lmst_h"] for p in later["points"]] == [round(1 / 60, 4)]


def test_air_temperature_is_celsius_over_the_five_sensors(db) -> None:
    series = environment.series(db, "air_temperature", 100, bin_minutes=5)
    kelvin = [v for _, values in column("CAL_ATS", *meda.PRODUCTS[3].columns) for v in values]
    (point,) = series["points"]
    assert point["samples"] == 600
    assert point["value"] == round(mean(kelvin) - 273.15, 2)
    assert (point["min"], point["max"]) == (round(min(kelvin) - 273.15, 2), round(max(kelvin) - 273.15, 2))
    assert series["unit"] == "°C" and series["source_dataset"] == "m2020_meda_calibrated"


@pytest.mark.parametrize("parameter", ["wind_speed", "wind_direction"])
def test_unusable_wind_readings_are_gaps_not_zeros(db, parameter: str) -> None:
    series = environment.series(db, parameter, 100, bin_minutes=5)
    assert series["points"] and all(p["value"] is None and p["samples"] == 0 for p in series["points"])
    assert series["quality"]["empty_bins"] == series["quality"]["bins"]
    assert series["quality"]["samples"] == 0


def test_wind_direction_mean_wraps_through_north() -> None:
    direction = environment.PARAMETERS["wind_direction"]
    assert environment._summarise([350.0, 10.0], direction) == (0.0, None, None)  # not 180
    assert environment._summarise([80.0, 100.0], direction) == (90.0, None, None)
    assert environment._summarise([], direction) == (None, None, None)


def test_sol_or_station_without_data_is_refused_not_substituted(db, client: TestClient) -> None:
    with pytest.raises(AppError) as err:
        environment.series(db, "pressure", 9999)
    assert (err.value.status_code, err.value.code) == (404, "MEDA_SOL_NOT_FOUND")

    url = "/api/v1/environment/observations"
    foreign = client.get(url, params={"parameter": "pressure", "station": "msl_rems"})
    assert (foreign.status_code, foreign.json()["error"]["code"]) == (404, "STATION_NOT_INTEGRATED")
    assert client.get(url, params={"parameter": "radiation"}).status_code == 422  # no series: see the registry
    backwards = client.get(url, params={"parameter": "pressure", "lmst_from": 10, "lmst_to": 5})
    assert (backwards.status_code, backwards.json()["error"]["code"]) == (422, "EMPTY_TIME_RANGE")


def test_registry_tells_series_from_maps_and_from_sources_that_are_not_loaded(db, client: TestClient) -> None:
    registry = environment.registry(db)
    EnvRegistryRead(**registry)
    assert [p["id"] for p in registry["parameters"]] == list(environment.PARAMETER_LABELS)
    assert {p["id"] for p in registry["parameters"] if p["series"]} == set(environment.PARAMETERS)
    assert set(registry["kinds"]) == {"HISTORICAL_OBSERVATION", "PROCESSED_OBSERVATION", "MODEL_ESTIMATE", "SIMULATION"}

    sources = {s["id"]: s for s in registry["sources"]}
    assert {p for s in sources.values() for p in s["parameters"]} == set(environment.PARAMETER_LABELS)
    wind = sources["meda_der_ws"]
    assert (wind["availability"], wind["available_sols"]) == ("series", [100])
    assert wind["parameters"] == ["wind_speed", "wind_direction"]
    assert wind["observed_at_start"].startswith("2021-0")
    assert sources["themis_ir"]["availability"] == "map"
    assert sources["msl_rems"]["availability"] == "not_integrated"
    assert sources["msl_rems"]["location"]["lat"] == -4.5895  # Gale crater: never mixed into Jezero
    assert all(s["note"] and (s["source_url"] or s["dataset_ids"]) for s in sources.values())

    assert client.get("/api/v1/environment/registry").status_code == 200
