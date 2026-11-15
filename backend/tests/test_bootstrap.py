from pathlib import Path

from app.bootstrap import SEED_PATH, copy_blocks


def test_copy_blocks_keep_semicolons_inside_rows():
    sql = "COPY public.missions (id, name) FROM stdin;\nmgs\tMars; Odyssey\n\\.\n"
    assert copy_blocks(sql) == [
        ("COPY public.missions (id, name) FROM STDIN", "mgs\tMars; Odyssey\n")
    ]


def test_shipped_catalogue_includes_ctx_global():
    text = Path(SEED_PATH).read_text(encoding="utf-8")
    headers = [header for header, _ in copy_blocks(text)]
    assert any("map_layers" in header for header in headers)
    assert "ctx_global" in text
    assert "mgs_mola_dem_463m" in text
