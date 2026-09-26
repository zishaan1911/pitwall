"""Season catalogue: which sessions exist and which have been built."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .bundle import session_dir
from .sources import f1


def built(root: Path, year: int, round_: int, kind: str) -> bool:
    return (session_dir(root, year, round_, kind) / "session.json").exists()


def index(root: Path, seasons: list[int], *, mode: str, only_built: bool) -> dict:
    out = []
    for year in sorted(seasons, reverse=True):
        events = []
        for ev in f1.schedule(year):
            done = [k for k in ev["sessions"] if built(root, year, ev["round"], k)]
            if only_built and not done:
                continue
            events.append({**ev, "built": done})
        if events:
            out.append({"year": year, "events": events})
    return {
        "mode": mode,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "seasons": out,
    }


def write_index(root: Path, seasons: list[int]) -> Path:
    path = root / "index.json"
    path.write_text(
        json.dumps(index(root, seasons, mode="static", only_built=True), separators=(",", ":")),
        encoding="utf-8",
    )
    return path
