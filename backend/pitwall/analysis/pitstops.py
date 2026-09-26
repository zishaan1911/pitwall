"""Pit stop ledger and measured pit loss.

Pit loss is what a stop costs compared with staying out: the in-lap plus the
out-lap, minus what those two laps would have taken on track.

* Green flag: the reference is the tyre model's prediction for that driver,
  compound and tyre age.
* Safety car / VSC: the model knows nothing about neutralised pace, so the
  reference is the median time of the cars that stayed out on those laps.
  Everyone is slowed, which makes these stops much cheaper.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .degradation import DegModel

PLAUSIBLE = (5.0, 60.0)  # seconds; outside this is damage, a penalty or a red flag


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

    stayed_out = laps[~laps["pit_in"] & ~laps["pit_out"]].groupby("lap")["time"].median()

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
                loss = _loss_neutralised(a, b, lap, stayed_out)
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


def _loss_neutralised(a, b, lap, stayed_out: pd.Series) -> float | None:
    if pd.isna(a["time"]) or pd.isna(b["time"]):
        return None
    ref_in, ref_out = stayed_out.get(lap), stayed_out.get(lap + 1)
    if ref_in is None or ref_out is None or pd.isna(ref_in) or pd.isna(ref_out):
        return None
    return float(a["time"] + b["time"] - ref_in - ref_out)


def summary(stops: list[dict]) -> dict:
    out = {}
    for kind in ("GREEN", "SC", "VSC"):
        vals = np.array([
            s["loss"] for s in stops
            if s["kind"] == kind and s["new_set"] and s["loss"] is not None
            and PLAUSIBLE[0] <= s["loss"] <= PLAUSIBLE[1]
        ])
        if len(vals):
            q1, q3 = np.percentile(vals, [25, 75])
            out[kind] = {"median": round(float(np.median(vals)), 3), "q1": round(float(q1), 3),
                         "q3": round(float(q3), 3), "n": int(len(vals))}
    lanes = [s["lane"] for s in stops if s["lane"] and s["kind"] == "GREEN"]
    if lanes:
        out["lane_median"] = round(float(np.median(lanes)), 2)
    stationary = [s["stationary"] for s in stops if s["stationary"]]
    if stationary:
        out["stationary_median"] = round(float(np.median(stationary)), 2)
        out["stationary_best"] = round(float(np.min(stationary)), 2)
    return out
