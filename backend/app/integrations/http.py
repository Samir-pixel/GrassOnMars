"""Shared HTTP access for NASA connectors: bounded retries, rate-limit backoff, structured errors."""

from __future__ import annotations

import logging
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError

logger = logging.getLogger("marswalk.integrations")

USER_AGENT = "MARSWALK/0.5 (Jezero EVA planning study)"
MAX_RETRY_AFTER_S = 30.0


class UpstreamError(AppError):
    """A NASA service or archive failed; details carry the source and URL into the error envelope."""

    def __init__(
        self, status_code: int, code: str, message_ru: str, source: str, url: str, **details: Any
    ) -> None:
        super().__init__(status_code, code, message_ru, {"source": source, "url": url, **details})


@lru_cache(maxsize=1)
def shared_client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(20.0, connect=10.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def fetch(
    client: httpx.Client,
    source: str,
    url: str,
    attempts: int = 3,
    byte_range: tuple[int, int] | None = None,
) -> httpx.Response:
    """GET that returns only a 200, or only a 206 when `byte_range` (offset, length) is given.

    404 is final; timeouts, network errors, 429 and 5xx are retried.
    """
    headers, expected = {}, 200
    if byte_range:
        offset, length = byte_range
        headers, expected = {"Range": f"bytes={offset}-{offset + length - 1}"}, 206
    delay = 1.0
    for attempt in range(1, attempts + 1):
        try:
            # Streamed: the body is read only once the status is the expected one, so a server
            # that ignores Range cannot push a multi-gigabyte file at us.
            with client.stream("GET", url, headers=headers) as response:
                if response.status_code == expected:
                    response.read()
        except httpx.TimeoutException:
            error = UpstreamError(
                504, "UPSTREAM_TIMEOUT", f"{source}: сервис не ответил вовремя.", source, url
            )
        except httpx.HTTPError as exc:
            error = UpstreamError(
                502,
                "UPSTREAM_UNAVAILABLE",
                f"{source}: сервис недоступен.",
                source,
                url,
                reason=exc.__class__.__name__,
            )
        else:
            status = response.status_code
            if status == expected:
                return response
            if status == 404:
                raise UpstreamError(
                    404, "UPSTREAM_NOT_FOUND", f"{source}: ресурс не найден.", source, url
                )
            if status == 429:
                error = UpstreamError(
                    503,
                    "UPSTREAM_RATE_LIMITED",
                    f"{source}: превышен лимит запросов.",
                    source,
                    url,
                )
            else:
                error = UpstreamError(
                    502,
                    "UPSTREAM_UNAVAILABLE",
                    f"{source}: сервис вернул ошибку.",
                    source,
                    url,
                    upstream_status=status,
                )
                if status < 500:
                    raise error  # other 4xx will not change on retry
            retry_after = response.headers.get("Retry-After", "")
            if retry_after.isdigit():
                delay = min(float(retry_after), MAX_RETRY_AFTER_S)
        if attempt < attempts:
            logger.warning("%s: attempt %d/%d failed (%s), retrying", source, attempt, attempts, error.code)
            time.sleep(delay)
            delay *= 2
    raise error
