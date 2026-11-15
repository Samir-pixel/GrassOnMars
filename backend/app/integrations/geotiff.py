"""Windowed access to the GeoTIFF DEMs that USGS Astrogeology publishes for Mars.

Works over any `read(offset, length) -> bytes`, so one parser serves a window of a 2 GB remote
file (HTTP Range) and a local subset on disk. The products checked for MARSWALK (MOLA 463 m, CTX
and HiRISE DTMs of Jezero) share one layout: classic TIFF, uncompressed, single band, strips;
equirectangular projection with standard parallel 0 and central meridian 0.

shortcut: no compression, tiles, BigTIFF or multi-band support; switch to rasterio/GDAL when a
product needs them.
"""

from __future__ import annotations

import base64
import math
import re
import struct
import sys
from array import array
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError
from app.integrations.http import UpstreamError, fetch, write_atomic

Read = Callable[[int, int], bytes]

READ_AHEAD = 256 * 1024  # one request covers a whole tag directory, even MOLA's 185 KB one
MAX_TAG_BYTES = 4 * 1024 * 1024
MAX_WINDOW_BYTES = 64 * 1024 * 1024
TYPE_SIZES = {2: 1, 3: 2, 4: 4, 12: 8}  # ASCII, SHORT, LONG, DOUBLE
TYPE_CODES = {3: "H", 4: "I", 12: "d"}
SAMPLE_TYPES = {(8, 1): "B", (16, 2): "h", (32, 3): "f"}  # (BitsPerSample, SampleFormat) -> array typecode
SAMPLE_FORMATS = {"B": 1, "h": 2, "f": 3}
WANTED_TAGS = {256, 257, 258, 259, 273, 277, 278, 279, 339, 33550, 33922, 34735, 34736, 34737, 42113}
CT_EQUIRECTANGULAR = 17
PARSE_ERRORS = (KeyError, IndexError, ValueError, TypeError, ZeroDivisionError, struct.error)


def invalid_data(source: str, name: str, reason: str) -> UpstreamError:
    return UpstreamError(
        502, "UPSTREAM_INVALID_DATA", f"{source}: получены некорректные данные.", source, name, reason=reason
    )


@dataclass(frozen=True)
class GeoTiff:
    width: int
    height: int
    typecode: str  # array typecode of one sample
    byte_order: str  # "<" or ">"
    rows_per_strip: int
    strip_offsets: tuple[int, ...]
    pixel_scale: float  # map units (metres) per pixel
    tie_x: float  # map coordinates of the outer corner of the top-left pixel
    tie_y: float
    nodata_text: str | None  # GDAL_NODATA, verbatim
    citation: str  # GeoAsciiParams, verbatim: the file's own CRS description
    geo_keys: tuple[int, ...]
    geo_doubles: tuple[float, ...]

    @property
    def nodata(self) -> float | None:
        return float(self.nodata_text) if self.nodata_text else None

    @property
    def semi_major_m(self) -> float | None:
        return _geo_key(self.geo_keys, self.geo_doubles, 2057)

    def row_offset(self, row: int) -> int:
        strip, line = divmod(row, self.rows_per_strip)
        return self.strip_offsets[strip] + line * self.width * array(self.typecode).itemsize


def _geo_key(keys: tuple[int, ...], doubles: tuple[float, ...], key: int) -> float | None:
    for i in range(4, len(keys) - 3, 4):  # entries of (key, tag location, count, value or index)
        if keys[i] == key:
            return doubles[keys[i + 3]] if keys[i + 1] == 34736 else keys[i + 3]
    return None


def open_geotiff(read: Read, source: str, name: str) -> GeoTiff:
    """Read and validate a TIFF directory. `name` (URL or path) is reported in errors."""
    try:
        header = read(0, 8)
        order = {b"II": "<", b"MM": ">"}[header[:2]]
        magic, ifd = struct.unpack(order + "HI", header[2:8])
        if magic != 42:
            raise ValueError("not a classic TIFF")
        (count,) = struct.unpack(order + "H", read(ifd, 2))  # MOLA keeps its directory at the end
        entries = read(ifd + 2, count * 12)
        tags: dict[int, tuple | bytes] = {}
        for i in range(count):
            tag, kind, n, value = struct.unpack(order + "HHI4s", entries[i * 12 : i * 12 + 12])
            if tag not in WANTED_TAGS:
                continue
            size = TYPE_SIZES[kind] * n
            if size > MAX_TAG_BYTES:
                raise ValueError(f"tag {tag} is implausibly large")
            data = value[:size] if size <= 4 else read(struct.unpack(order + "I", value)[0], size)
            tags[tag] = data if kind == 2 else struct.unpack(f"{order}{n}{TYPE_CODES[kind]}", data)

        width, height = tags[256][0], tags[257][0]
        typecode = SAMPLE_TYPES[(tags[258][0], tags.get(339, (1,))[0])]
        rows_per_strip = min(tags.get(278, (height,))[0], height)
        row_bytes = width * array(typecode).itemsize
        strips, strip_sizes = tags[273], tags[279]
        scale_x, scale_y = tags[33550][:2]
        tie = tags[33922]
        keys, doubles = tags[34735], tags.get(34736, ())
        nodata = tags[42113].split(b"\0")[0].decode("ascii").strip() if 42113 in tags else None
        problems = [
            reason
            for ok, reason in (
                (tags[259][0] == 1, "compressed"),
                (tags.get(277, (1,))[0] == 1, "more than one band"),
                (width > 0 and len(strips) == len(strip_sizes) == -(-height // rows_per_strip), "strip layout"),
                (
                    all(
                        size == min(rows_per_strip, height - i * rows_per_strip) * row_bytes
                        for i, size in enumerate(strip_sizes)
                    ),
                    "strip sizes",
                ),
                (scale_x == scale_y > 0 and tie[:2] == (0.0, 0.0), "pixel scale or tiepoint"),
                (_geo_key(keys, doubles, 1025) == 1, "raster type is not PixelIsArea"),
                (
                    # What pixel_at() assumes: x and y are plain multiples of longitude and latitude.
                    _geo_key(keys, doubles, 3075) == CT_EQUIRECTANGULAR
                    and not any(_geo_key(keys, doubles, k) for k in (3078, 3080, 3088, 3082, 3083)),
                    "projection is not equirectangular with lat_ts 0, lon_0 0",
                ),
                (nodata is None or math.isfinite(float(nodata)), "nodata value"),
            )
            if not ok
        ]
        if problems:
            raise ValueError("; ".join(problems))
        return GeoTiff(
            width=width,
            height=height,
            typecode=typecode,
            byte_order=order,
            rows_per_strip=rows_per_strip,
            strip_offsets=strips,
            pixel_scale=scale_x,
            tie_x=tie[3],
            tie_y=tie[4],
            nodata_text=nodata,
            citation=tags.get(34737, b"").rstrip(b"\0").decode("latin-1"),
            geo_keys=keys,
            geo_doubles=doubles,
        )
    except PARSE_ERRORS as exc:
        raise invalid_data(source, name, f"unsupported or damaged GeoTIFF: {exc!r}") from exc


def read_window(tiff: GeoTiff, read: Read, col: int, row: int, width: int, height: int) -> array:
    """Samples of a pixel window, row by row, in the machine's byte order."""
    if not (0 <= col and 0 <= row and width > 0 and height > 0):
        raise ValueError("empty window")
    if col + width > tiff.width or row + height > tiff.height:
        raise ValueError("window outside the raster")
    item = array(tiff.typecode).itemsize
    first = tiff.row_offset(row) + col * item
    span = tiff.row_offset(row + height - 1) + (col + width) * item - first
    if span > MAX_WINDOW_BYTES:
        raise ValueError(f"window needs {span} bytes in one read, the limit is {MAX_WINDOW_BYTES}")
    # shortcut: one read from the window's first to its last sample, full-width rows in between;
    # read row by row when a product's rows are too wide for that (HiRISE 1 m DTM).
    block = read(first, span)
    if len(block) != span:
        raise ValueError("short read")
    samples = array(tiff.typecode)
    for r in range(row, row + height):
        start = tiff.row_offset(r) + col * item - first
        samples.frombytes(block[start : start + width * item])
    if (tiff.byte_order == "<") != (sys.byteorder == "little"):
        samples.byteswap()
    return samples


def build_subset_bytes(
    tiff: GeoTiff,
    col: int,
    row: int,
    width: int,
    samples: array,
    *,
    pixel_scale: float | None = None,
    nodata_text: str | None = None,
) -> bytes:
    """Encode a window as standalone GeoTIFF bytes with Mars CRS keys and shifted tiepoint."""
    height = len(samples) // width
    if sys.byteorder == "big":
        samples = array(samples.typecode, samples)
        samples.byteswap()
    pixels = samples.tobytes()
    scale = pixel_scale if pixel_scale is not None else tiff.pixel_scale
    tie = (0.0, 0.0, 0.0, tiff.tie_x + col * tiff.pixel_scale, tiff.tie_y - row * tiff.pixel_scale, 0.0)
    nodata = tiff.nodata_text if nodata_text is None else nodata_text

    def packed(code: str, *values: float) -> bytes:
        return struct.pack(f"<{len(values)}{code}", *values)

    fields = [  # (tag, TIFF type, value bytes), ascending tags as the format requires
        (256, 4, packed("I", width)),
        (257, 4, packed("I", height)),
        (258, 3, packed("H", samples.itemsize * 8)),
        (259, 3, packed("H", 1)),
        (262, 3, packed("H", 1)),
        (273, 4, packed("I", 8)),
        (277, 3, packed("H", 1)),
        (278, 4, packed("I", height)),
        (279, 4, packed("I", len(pixels))),
        (339, 3, packed("H", SAMPLE_FORMATS[samples.typecode])),
        (33550, 12, packed("d", scale, scale, 0.0)),
        (33922, 12, packed("d", *tie)),
        (34735, 3, packed("H", *tiff.geo_keys)),
        (34736, 12, packed("d", *tiff.geo_doubles)),
        (34737, 2, tiff.citation.encode("latin-1") + b"\0" if tiff.citation else b""),
        (42113, 2, nodata.encode("ascii") + b"\0" if nodata else b""),
    ]
    body = bytearray(pixels)
    entries = b""
    count = 0
    for tag, kind, data in fields:
        if not data:
            continue
        if len(data) > 4:
            body += b"\0" * (len(body) % 2)  # values start on even offsets
            value = packed("I", 8 + len(body))
            body += data
        else:
            value = data.ljust(4, b"\0")
        entries += struct.pack("<HHI4s", tag, kind, len(data) // TYPE_SIZES[kind], value)
        count += 1
    body += b"\0" * (len(body) % 2)
    return b"II" + struct.pack("<HI", 42, 8 + len(body)) + bytes(body) + packed("H", count) + entries + packed("I", 0)


def write_subset(path: Path, tiff: GeoTiff, col: int, row: int, width: int, samples: array) -> None:
    """Save a window as a standalone GeoTIFF: same samples and CRS keys, tiepoint moved to the window."""
    write_atomic(path, build_subset_bytes(tiff, col, row, width, samples))


def pixel_at(tiff: GeoTiff, lon: float, lat: float, pixels_per_degree: float) -> tuple[int, int] | None:
    """Column and row of the pixel containing a lon/lat point; None outside the raster."""
    col = math.floor(lon * pixels_per_degree - round(tiff.tie_x / tiff.pixel_scale, 6))
    row = math.floor(round(tiff.tie_y / tiff.pixel_scale, 6) - lat * pixels_per_degree)
    return (col, row) if 0 <= col < tiff.width and 0 <= row < tiff.height else None


def lon_lat_at(tiff: GeoTiff, col: float, row: float, pixels_per_degree: float) -> tuple[float, float]:
    """Lon/lat of a pixel-grid position (integers are pixel corners, +0.5 is a pixel centre)."""
    return (
        (col + tiff.tie_x / tiff.pixel_scale) / pixels_per_degree,
        (tiff.tie_y / tiff.pixel_scale - row) / pixels_per_degree,
    )


def window_grid(
    tiff: GeoTiff, samples: array, pixels_per_degree: float, west: float, south: float, east: float, north: float, step: int, max_cells: int
) -> dict[str, Any] | None:
    """Every `step`-th cell of a lon/lat window, values unchanged, rows from north to south.

    Each sample is the native cell at the centre of its step x step block (for an even step,
    the cell north-west of the centre). The returned bounds are the outer edges of the blocks.
    None when the raster does not cover the whole window.
    """
    first, last = pixel_at(tiff, west, north, pixels_per_degree), pixel_at(tiff, east, south, pixels_per_degree)
    if first is None or last is None:
        return None
    (col, row), cols, rows = first, (last[0] - first[0]) // step, (last[1] - first[1]) // step
    if cols < 2 or rows < 2 or cols * rows > max_cells:
        raise AppError(
            422,
            "GRID_SIZE",
            "Область пуста или слишком велика для выбранного шага.",
            {"rows": rows, "cols": cols, "max_cells": max_cells},
        )
    centre = (step - 1) // 2
    values = array("f")
    for r in range(rows):
        start = (row + r * step + centre) * tiff.width + col + centre
        values.extend(math.nan if v == tiff.nodata else v for v in samples[start : start + cols * step : step])
    if sys.byteorder == "big":
        values.byteswap()
    west, north = lon_lat_at(tiff, col, row, pixels_per_degree)
    east, south = lon_lat_at(tiff, col + cols * step, row + rows * step, pixels_per_degree)
    return {
        "step": step,
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "rows": rows,
        "cols": cols,
        "elevation_f32_b64": base64.b64encode(values.tobytes()).decode("ascii"),
    }


@lru_cache(maxsize=32)  # the CTX mosaic plus one small MOLA window per Marswalk region
def _load(path: Path, modified_ns: int, source: str) -> tuple[GeoTiff, array]:
    data = path.read_bytes()

    def read(offset: int, length: int) -> bytes:
        return data[offset : offset + length]

    tiff = open_geotiff(read, source, str(path))
    return tiff, read_window(tiff, read, 0, 0, tiff.width, tiff.height)


def load(path: Path, source: str) -> tuple[GeoTiff, array]:
    """A local raster and all its samples, kept in memory until the file changes."""
    return _load(path, path.stat().st_mtime_ns, source)


def sample(path: Path, source: str, lon: float, lat: float, pixels_per_degree: float) -> dict[str, float | None] | None:
    """Value of the grid cell containing the point (no interpolation); None outside the raster."""
    tiff, samples = load(path, source)
    pixel = pixel_at(tiff, lon, lat, pixels_per_degree)
    if pixel is None:
        return None
    col, row = pixel
    value = samples[row * tiff.width + col]
    pixel_lon, pixel_lat = lon_lat_at(tiff, col + 0.5, row + 0.5, pixels_per_degree)
    return {
        "elevation_m": None if value == tiff.nodata else float(value),
        "pixel_lon": pixel_lon,
        "pixel_lat": pixel_lat,
    }


def bounds(tiff: GeoTiff, pixels_per_degree: float) -> list[float]:
    """West, south, east, north of the raster's outer edge, degrees."""
    west, north = lon_lat_at(tiff, 0, 0, pixels_per_degree)
    east, south = lon_lat_at(tiff, tiff.width, tiff.height, pixels_per_degree)
    return [west, south, east, north]


class RangeReader:
    """`read(offset, length)` over HTTP Range requests, reading ahead for the small directory reads."""

    def __init__(self, client: httpx.Client, source: str, url: str) -> None:
        self.client, self.source, self.url = client, source, url
        self.ranges: list[tuple[int, int]] = []  # (offset, length) of every request, for provenance
        self.stamp: tuple[str | None, str | None, int] | None = None  # ETag, Last-Modified, size
        self._start, self._block = 0, b""

    def __call__(self, offset: int, length: int) -> bytes:
        if not (self._start <= offset and offset + length <= self._start + len(self._block)):
            want = max(length, READ_AHEAD)
            if self.stamp:
                want = min(want, self.stamp[2] - offset)
            if want < length:
                raise invalid_data(self.source, self.url, "read beyond the end of the file")
            response = fetch(self.client, self.source, self.url, byte_range=(offset, want))
            data = response.content
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if not match or int(match[1]) != offset or int(match[2]) - offset + 1 != len(data) or len(data) < length:
                raise invalid_data(self.source, self.url, "range response does not match the request")
            stamp = (response.headers.get("ETag"), response.headers.get("Last-Modified"), int(match[3]))
            if self.stamp not in (None, stamp):
                raise invalid_data(self.source, self.url, "remote file changed between requests")
            self.stamp = stamp
            self.ranges.append((offset, len(data)))
            self._start, self._block = offset, data
        return self._block[offset - self._start : offset - self._start + length]
