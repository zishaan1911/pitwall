"""Jolpica (the Ergast successor, api.jolpi.ca): circuit location and standings."""

from __future__ import annotations

from .http import get_json

BASE = "https://api.jolpi.ca/ergast/f1"
PACE = 0.3


def _race_table(path: str) -> list[dict]:
    data = get_json(f"{BASE}/{path}", min_interval=PACE)
    return data["MRData"].get("RaceTable", {}).get("Races", [])


def circuit(year: int, round_: int) -> dict | None:
    races = _race_table(f"{year}/{round_}.json")
    if not races:
        return None
    c = races[0]["Circuit"]
    return {
        "id": c["circuitId"],
        "name": c["circuitName"],
        "lat": float(c["Location"]["lat"]),
        "lon": float(c["Location"]["long"]),
        "wiki": c.get("url"),
    }


def standings_before(year: int, round_: int) -> list[dict]:
    """Drivers' championship as it stood before this round (empty for round 1)."""
    return standings_after(year, round_ - 1) if round_ > 1 else []


def standings_after(year: int, round_: int) -> list[dict]:
    """Drivers' championship after this round, sprint points included."""
    data = get_json(f"{BASE}/{year}/{round_}/driverStandings.json", min_interval=PACE)
    lists = data["MRData"]["StandingsTable"]["StandingsLists"]
    if not lists:
        return []
    return [
        {
            "position": int(row["position"]) if row.get("position") else None,
            "code": row["Driver"].get("code"),
            "name": f'{row["Driver"]["givenName"]} {row["Driver"]["familyName"]}',
            "team": row["Constructors"][-1]["name"] if row.get("Constructors") else None,
            "points": float(row["points"]),
            "wins": int(row["wins"]),
        }
        for row in lists[0]["DriverStandings"]
    ]
