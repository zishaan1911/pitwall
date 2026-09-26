"""Small JSON-over-HTTP helper with retries and polite pacing."""

from __future__ import annotations

import time
from typing import Any

import httpx

USER_AGENT = "pitwall (+https://github.com/zishaan1911/pitwall)"
_client: httpx.Client | None = None
_last_call: dict[str, float] = {}


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )
    return _client


def get_json(url: str, params: dict[str, Any] | None = None, *, min_interval: float = 0.0,
             retries: int = 4) -> Any:
    """GET `url` and decode JSON.

    `min_interval` spaces out calls to the same host (OpenF1 and Jolpica rate
    limit anonymous clients). 429 and 5xx responses are retried with backoff.
    """
    host = httpx.URL(url).host
    wait = _last_call.get(host, 0.0) + min_interval - time.monotonic()
    if wait > 0:
        time.sleep(wait)

    delay = 1.5
    for attempt in range(retries):
        try:
            resp = _get_client().get(url, params=params)
            _last_call[host] = time.monotonic()
            if resp.status_code == 429 or resp.status_code >= 500:
                raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
            resp.raise_for_status()
            return resp.json()
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status is not None and status < 500 and status != 429:
                raise
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")
