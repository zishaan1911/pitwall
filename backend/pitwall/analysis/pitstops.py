"""Pit stop ledger and measured pit loss.

Pit loss is what a stop costs compared with staying out: the in-lap plus the
out-lap, minus what those two laps would have taken on track.

* Green flag: the reference is the tyre model's prediction for that driver,
  compound and tyre age.
* Safety car / VSC: the model knows nothing about neutralised pace, so the
  loss is measured as the change in gap to every car that did not stop,
  from the line before the stop to the line after the out-lap. Gaps are
  taken at the same point on track, so it does not matter whether the SC came
  out early or late in a given car's lap. Only cars within 20 s count, and
  the median over cars ahead and behind cancels the field bunching up.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .degradation import DegModel

PLAUSIBLE = (5.0, 60.0)  # seconds; outside this is damage, a penalty or a red flag
SLOW_LANE = 4.0  # seconds over the median pit-lane time: a penalty served or a slow stop
SLOW_STATIONARY = 6.0  # seconds stationary: a problem at the stop, not a strategy cost
NEARBY = 20.0  # seconds; reference cars for a neutralised stop must be this close


def _kind(status: str) -> str:
    chars = set(status)
    if "5" in chars:
        return "RED"
    if "4" in chars:
        return "SC"
    if chars & {"6", "7"}:
        return "VSC"
    return "GREEN"


def ledger(laps: pd.DataFrame, model: DegModel | None,
           openf1_pits: list[dict] | None = None,
           numbers: dict[str, str] | None = None) -> list[dict]:
    by_key = {}
    for p in openf1_pits or []:
        by_key[(str(p.get("driver_number")), int(p.get("lap_number") or 0))] = p

    end = laps.pivot_table(index="lap", columns="driver", values="end")
    pitting = laps[laps["pit_in"] | laps["pit_out"]].groupby("driver")["lap"].agg(set)

    stops = []
    for driver, g in laps.groupby("driver", sort=False):
        g = g.set_index("lap").sort_index()
        for lap in g.index[g["pit_in"]]:
            if lap + 1 not in g.index or not g.at[lap + 1, "pit_out"]:
                continue  # retired in the pits or pitted on the final lap
            a, b = g.loc[lap], g.loc[lap + 1]
            kind = _kind(a["status"] + b["status"])
            new_set = (
                a["compound"] != b["compound"]
                or (pd.notna(a["age"]) and pd.notna(b["age"]) and b["age"] < a["age"])
            )
            if kind in ("SC", "VSC"):
                loss = _loss_by_gaps(driver, lap, end, pitting)
            elif kind == "GREEN":
                loss = _loss(driver, a, b, lap, g, model)
            else:
                loss = None  # red flag: the car sits in the pit lane while the race is stopped
            of1 = by_key.get((str(numbers.get(driver, "")) if numbers else "", int(lap)), {})
            stops.append({
                "driver": driver,
                "lap": int(lap),
                "session_time": round(float(a["end"]), 3) if pd.notna(a["end"]) else None,
                "kind": kind,
                "from": a["compound"],
                "to": b["compound"],
                "from_age": int(a["age"]) if pd.notna(a["age"]) else None,
                "new_set": bool(new_set),
                "loss": round(loss, 3) if loss is not None else None,
                "lane": of1.get("lane_duration") or of1.get("pit_duration"),
                "stationary": of1.get("stop_duration"),
            })
    stops.sort(key=lambda s: (s["lap"], s["session_time"] or 0))
    return stops


def _loss(driver, a, b, lap, g, model: DegModel | None) -> float | None:
    if pd.isna(a["time"]) or pd.isna(b["time"]):
        return None
    if model is not None:
        pin = model.predict(driver, a["compound"], a["age"], lap)
        pout = model.predict(driver, b["compound"], b["age"], lap + 1)
        if pin is not None and pout is not None:
            return float(a["time"] + b["time"] - pin - pout)
    near = g[g["clean"] & (abs(g.index - lap) <= 8)]["time"]
    if len(near) < 3:
        return None
    return float(a["time"] + b["time"] - 2 * near.median())


def _loss_by_gaps(driver: str, lap: int, end: pd.DataFrame, pitting: pd.Series) -> float | None:
    before, after = lap - 1, lap + 1
    if before < 1 or before not in end.index or after not in end.index:
        return None
    window = set(range(lap - 1, lap + 3))
    changes = []
    for other in end.columns:
        if other == driver or window & pitting.get(other, set()):
            continue
        g0 = end.at[before, driver] - end.at[before, other]
        g1 = end.at[after, driver] - end.at[after, other]
        # Only cars close by on track saw the neutralisation at the same moment.
        if pd.notna(g0) and pd.notna(g1) and abs(g0) <= NEARBY:
            changes.append(g1 - g0)
    if len(changes) < 2:
        return None
    return float(np.median(changes))


def lane_median(stops: list[dict]) -> float | None:
    lanes = [s["lane"] for s in stops if s["lane"] and s["kind"] == "GREEN"]
    return float(np.median(lanes)) if lanes else None


def is_normal(stop: dict, lane_med: float | None) -> bool:
    """A routine tyre stop whose loss says something about the strategy.

    Excludes lap-1 stops (the standing start distorts the in-lap), penalties
    and slow stops (from OpenF1 lane and stationary times where available),
    and anything outside the plausible range.
    """
    if not stop["new_set"] or stop["loss"] is None or stop["lap"] <= 1:
        return False
    if not PLAUSIBLE[0] <= stop["loss"] <= PLAUSIBLE[1]:
        return False
    if lane_med is not None and stop["lane"] and stop["lane"] > lane_med + SLOW_LANE:
        return False
    return not (stop["stationary"] and stop["stationary"] > SLOW_STATIONARY)


def summary(stops: list[dict]) -> dict:
    out = {}
    lane_med = lane_median(stops)
    for kind in ("GREEN", "SC", "VSC"):
        vals = np.array([
            s["loss"] for s in stops if s["kind"] == kind and is_normal(s, lane_med)
        ])
        if len(vals):
            q1, q3 = np.percentile(vals, [25, 75])
            out[kind] = {"median": round(float(np.median(vals)), 3), "q1": round(float(q1), 3),
                         "q3": round(float(q3), 3), "n": int(len(vals))}
    if lane_med is not None:
        out["lane_median"] = round(lane_med, 2)
    stationary = [s["stationary"] for s in stops if s["stationary"]]
    if stationary:
        out["stationary_median"] = round(float(np.median(stationary)), 2)
        out["stationary_best"] = round(float(np.min(stationary)), 2)
    return out
