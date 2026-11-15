"""Migrate and load the NASA catalogue, then start the API.

A new Postgres has no tables, so /layers returns 500 until Alembic runs. The
migration seed is the old three-layer set; the map needs seed/catalogue.sql.
Runs only from `python -m app.bootstrap` (the container command).
"""

from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.database import engine

SEED_PATH = Path(__file__).resolve().parents[1] / "seed" / "catalogue.sql"
# Child tables first. A fresh database only has the migration's demo rows.
WIPE = (
    "mission_reports",
    "simulations",
    "route_segments",
    "routes",
    "observations",
    "hazard_features",
    "scientific_targets",
    "map_layers",
    "dataset_lineage",
    "datasets",
    "instruments",
    "missions",
)


def copy_blocks(sql: str) -> list[tuple[str, str]]:
    """pg_dump COPY sections. Semicolons inside a row stay in the row."""
    sql = sql.replace("\r\n", "\n").replace("\r", "\n")
    lines = sql.splitlines(keepends=True)
    blocks: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        if lines[i].startswith("COPY "):
            header = lines[i].strip().removesuffix(";").replace(" FROM stdin", " FROM STDIN")
            i += 1
            body: list[str] = []
            while i < len(lines) and lines[i] != "\\.\n":
                body.append(lines[i])
                i += 1
            blocks.append((header, "".join(body)))
        i += 1
    return blocks


def load_catalogue(sql: str) -> str:
    blocks = copy_blocks(sql)
    if not blocks:
        raise RuntimeError(f"{SEED_PATH} has no COPY data")
    with engine.begin() as conn:
        present = conn.execute(
            text("SELECT 1 FROM map_layers WHERE id = 'ctx_global'")
        ).first()
        if present is not None:
            return "catalogue already loaded"
        for table in WIPE:
            conn.execute(text(f"DELETE FROM {table}"))
        dbapi = conn.connection.driver_connection
        with dbapi.cursor() as cur:
            for header, body in blocks:
                with cur.copy(header) as copy:
                    if body:
                        copy.write(body)
    return "catalogue loaded"


def main() -> None:
    cfg = Config(str(SEED_PATH.parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")
    print(load_catalogue(SEED_PATH.read_text(encoding="utf-8")))
    os.execvp(
        "uvicorn",
        ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
    )


if __name__ == "__main__":
    main()
