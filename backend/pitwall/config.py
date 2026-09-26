"""Runtime settings, read from environment variables."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _path(name: str, default: Path) -> Path:
    return Path(os.environ.get(name, default)).resolve()


DATA_DIR = _path("PITWALL_DATA", ROOT / "data")
CACHE_DIR = _path("PITWALL_CACHE", ROOT / ".fastf1-cache")
FRONTEND_DIST = _path("PITWALL_FRONTEND", ROOT / "frontend" / "dist")

_this_year = datetime.now(UTC).year
SEASONS = [
    int(y) for y in os.environ.get("PITWALL_SEASONS", f"{_this_year - 1},{_this_year}").split(",")
    if y.strip()
]
