"""Undercut / overcut ledger.

For two cars running within 4 s of each other, where one stops and the other
stops up to six laps later (same stop number, green flag throughout), compare
the gap on the lap before the first stop with the gap once both have
completed their out-laps. The difference is what the stop timing was worth.
Stops outside the plausible pit-loss range are left out, so the stop number
counts only normal tyre stops.
"""

from __future__ import annotations

import pandas as pd

from .pitstops import PLAUSIBLE

MAX_GAP = 4.0
MAX_OFFSET = 6


def ledger(laps: pd.DataFrame, stops: list[dict]) -> list[dict]:
    end = laps.pivot_table(index="lap", columns="driver", values="end")
    neutral = laps.groupby("lap")["neutralised"].any()

    by_driver: dict[str, list[dict]] = {}
    for s in stops:
        # Skip stops with damage, penalties or slow wheel changes: they are not
        # strategy calls and would swamp the ledger.
        if s["new_set"] and s["loss"] is not None and PLAUSIBLE[0] <= s["loss"] <= PLAUSIBLE[1]:
            by_driver.setdefault(s["driver"], []).append(s)

    rows = []
    for a, a_stops in by_driver.items():
        for k, sa in enumerate(a_stops):
            for b, b_stops in by_driver.items():
                if b == a or k >= len(b_stops):
                    continue
                sb = b_stops[k]
                if not 0 < sb["lap"] - sa["lap"] <= MAX_OFFSET:
                    continue
                before, after = sa["lap"] - 1, sb["lap"] + 1
                if before < 1 or after not in end.index or before not in end.index:
                    continue
                if neutral.loc[before:after].any():
                    continue
                if sa["kind"] != "GREEN" or sb["kind"] != "GREEN":
                    continue
                g0 = end.at[before, a] - end.at[before, b]
                g1 = end.at[after, a] - end.at[after, b]
                if pd.isna(g0) or pd.isna(g1) or abs(g0) > MAX_GAP:
                    continue
                gain = g0 - g1
                if g0 > 0 > g1:
                    verdict = "UNDERCUT"      # early stopper got ahead
                elif g0 < 0 < g1:
                    verdict = "OVERCUT"       # late stopper got ahead
                else:
                    verdict = "HELD"
                rows.append({
                    "early": a,
                    "late": b,
                    "stop": k + 1,
                    "early_lap": sa["lap"],
                    "late_lap": sb["lap"],
                    "gap_before": round(float(g0), 3),
                    "gap_after": round(float(g1), 3),
                    "gain": round(float(gain), 3),
                    "verdict": verdict,
                })
    rows.sort(key=lambda r: -abs(r["gain"]))
    return rows
