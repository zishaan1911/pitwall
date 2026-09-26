"""OpenF1 (api.openf1.org): pit lane timing, team radio and on-track overtakes."""

from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from .http import get_json

BASE = "https://api.openf1.org/v1"
PACE = 0.4  # seconds between calls; the free tier allows 3 req/s


def _get(endpoint: str, **params) -> list[dict]:
    data = get_json(f"{BASE}/{endpoint}", params=params, min_interval=PACE)
    # OpenF1 answers "no data" with {"detail": "No results found."}
    return data if isinstance(data, list) else []


def find_session_key(year: int, session_name: str, start_utc: datetime) -> int | None:
    """Match a FastF1 session to its OpenF1 session_key by name and start time."""
    sessions = _get("sessions", year=year, session_name=session_name)
    best, best_dt = None, timedelta(hours=36)
    for s in sessions:
        start = pd.Timestamp(s["date_start"]).tz_convert("UTC").tz_localize(None).to_pydatetime()
        dt = abs(start - start_utc)
        if dt < best_dt:
            best, best_dt = s["session_key"], dt
    return best


def pit(session_key: int) -> list[dict]:
    return _get("pit", session_key=session_key)


def team_radio(session_key: int) -> list[dict]:
    return _get("team_radio", session_key=session_key)


def overtakes(session_key: int) -> list[dict]:
    return _get("overtakes", session_key=session_key)


def to_naive_utc(ts: str) -> datetime:
    return pd.Timestamp(ts).tz_convert("UTC").tz_localize(None).to_pydatetime()
