"""FastF1: the official F1 live-timing archive (laps, tyres, weather, telemetry)."""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from pathlib import Path

import fastf1
import pandas as pd

SESSION_NAMES = {"R": "Race", "S": "Sprint"}

_cache_enabled = False


def enable_cache(path: Path) -> None:
    global _cache_enabled
    if not _cache_enabled:
        path.mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(str(path))
        fastf1.set_log_level(logging.WARNING)
        _cache_enabled = True


def _missing(session) -> list[str]:
    """Parts of the session FastF1 failed to fetch.

    FastF1 logs a warning and carries on when a request fails, so a flaky
    connection silently yields a session without weather or telemetry.
    """
    missing = []
    for name in ("laps", "t0_date", "results", "weather_data", "race_control_messages",
                 "car_data", "pos_data"):
        try:
            value = getattr(session, name)
            if value is None or (hasattr(value, "empty") and value.empty and name != "results"):
                missing.append(name)
        except Exception:  # noqa: BLE001 - DataNotLoadedError and friends
            missing.append(name)
    return missing


def load(year: int, round_: int, kind: str, attempts: int = 3):
    """Load a session, retrying while parts of it are missing.

    Successful responses are cached by FastF1, so a retry only refetches what failed.
    """
    for attempt in range(1, attempts + 1):
        session = fastf1.get_session(year, round_, kind)
        session.load(laps=True, telemetry=True, weather=True, messages=True)
        missing = _missing(session)
        if not missing:
            return session
        # Timing is there and only telemetry is missing: some sessions genuinely lack it.
        if set(missing) <= {"car_data", "pos_data"} and attempt == attempts:
            return session
        if attempt < attempts:
            time.sleep(10 * attempt)
    raise LookupError(f"{year} round {round_} {kind}: could not load {', '.join(missing)}")


def schedule(year: int) -> list[dict]:
    """Past race weekends of a season with their race-type sessions."""
    sched = fastf1.get_event_schedule(year, include_testing=False)
    now = datetime.now(UTC).replace(tzinfo=None)
    events = []
    for _, ev in sched.iterrows():
        sessions = []
        for i in range(1, 6):
            name = ev.get(f"Session{i}")
            date = ev.get(f"Session{i}DateUtc")
            if name in ("Race", "Sprint") and pd.notna(date) and date + pd.Timedelta(hours=3) < now:
                sessions.append("R" if name == "Race" else "S")
        if sessions:
            events.append({
                "round": int(ev["RoundNumber"]),
                "name": ev["EventName"],
                "country": ev["Country"],
                "location": ev["Location"],
                "date": ev["EventDate"].date().isoformat(),
                "sessions": sorted(sessions, key="SR".index),
            })
    return events
