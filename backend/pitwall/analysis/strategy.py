"""Race strategy optimiser built on the fitted tyre model and measured pit loss.

The model's fuel/track term is additive and the same for every car, so the
modelled race time of a strategy is

    sum over stints of  sum_{age=1..L} tyre_cost(compound, age)
    + stops * green-flag pit loss                  (+ a constant)

That lets every 1-, 2- and 3-stop plan be scored exhaustively. Stints are
capped a few laps past the oldest tyre actually run on that compound, so the
optimiser never relies on wear curves far beyond the data.
"""

from __future__ import annotations

from itertools import combinations_with_replacement

import numpy as np
import pandas as pd

from .degradation import DegModel
from .laps import DRY

MIN_STINT = 4
EXTRAPOLATE = 3
WINDOW = 1.0  # seconds: a pit lap is "in the window" if it costs < 1 s over the best


def _stint_tables(model: DegModel, compounds: list[str], total: int) -> dict[str, np.ndarray]:
    """cost[c][L] = modelled time of a stint of L laps on a new set of c."""
    tables = {}
    for c in compounds:
        per_lap = model.compounds[c].cost(np.arange(1, total + 1))
        cum = np.concatenate([[0.0], np.cumsum(per_lap)])
        cap = min(total, model.compounds[c].age_max + EXTRAPOLATE)
        cum[cap + 1:] = np.inf
        cum[:MIN_STINT] = np.inf
        tables[c] = cum
    return tables


def _best_split(seq: tuple[str, ...], tables, total: int):
    """Minimum cost and stint lengths for compounds `seq` covering `total` laps."""
    k = len(seq)
    L = np.arange(total + 1)
    if k == 2:
        cost = tables[seq[0]][L[1:total]] + tables[seq[1]][total - L[1:total]]
        i = int(np.argmin(cost))
        return float(cost[i]), [int(L[1 + i]), int(total - L[1 + i])], cost
    if k == 3:
        a = L[:, None]
        b = L[None, :]
        rest = total - a - b
        valid = rest >= 0
        cost = np.where(
            valid,
            tables[seq[0]][a] + tables[seq[1]][b] + tables[seq[2]][np.clip(rest, 0, total)],
            np.inf,
        )
        i, j = np.unravel_index(int(np.argmin(cost)), cost.shape)
        return float(cost[i, j]), [int(i), int(j), int(total - i - j)], cost
    if k == 4:
        a = L[:, None, None]
        b = L[None, :, None]
        c = L[None, None, :]
        rest = total - a - b - c
        valid = rest >= 0
        cost = np.where(
            valid,
            tables[seq[0]][a] + tables[seq[1]][b] + tables[seq[2]][c]
            + tables[seq[3]][np.clip(rest, 0, total)],
            np.inf,
        )
        i, j, m = np.unravel_index(int(np.argmin(cost)), cost.shape)
        return float(cost[i, j, m]), [int(i), int(j), int(m), int(total - i - j - m)], cost
    raise ValueError(k)


def optimise(model: DegModel, total: int, pit_loss: float, wet: bool = False) -> dict | None:
    order = {c: i for i, c in enumerate(DRY)}
    compounds = sorted((c for c in model.compounds if c in DRY), key=order.get)
    if wet or not compounds:
        return None
    tables = _stint_tables(model, compounds, total)

    plans = []
    for stops in (1, 2, 3):
        for seq in combinations_with_replacement(compounds, stops + 1):
            if len(set(seq)) < 2:  # dry-race rule: two different compounds
                continue
            cost, lengths, grid = _best_split(seq, tables, total)
            if not np.isfinite(cost):
                continue
            plans.append({
                "stops": stops,
                "seq": seq,
                "lengths": lengths,
                "time": cost + stops * pit_loss,
                "grid": grid,
            })
    if not plans:
        return None

    plans.sort(key=lambda p: p["time"])
    best_time = plans[0]["time"]

    def describe(p):
        laps_done, stints = 0, []
        for c, n in zip(p["seq"], p["lengths"], strict=True):
            stints.append({"compound": c, "laps": n, "from": laps_done + 1, "to": laps_done + n})
            laps_done += n
        return {
            "stops": p["stops"],
            "stints": stints,
            "delta": round(p["time"] - best_time, 3),
            "window": _window(p, total),
        }

    best_by_stops = {}
    for p in plans:
        best_by_stops.setdefault(p["stops"], p)

    one_stop = best_by_stops.get(1)
    return {
        "pit_loss": pit_loss,
        "reference_time": best_time,
        "compounds": compounds,
        "ranked": [describe(p) for p in plans[:10]],
        "best_by_stops": {str(k): describe(v) for k, v in sorted(best_by_stops.items())},
        "one_stop_curve": _one_stop_curve(one_stop, tables, total, best_time, pit_loss),
    }


def _window(p, total: int) -> list[list[int]]:
    """For each stop, the range of laps that keeps the plan within WINDOW s of its best."""
    grid = p["grid"]
    stops = p["stops"]
    best = np.min(grid)
    ok = np.argwhere(grid <= best + WINDOW)
    if stops == 1:
        laps = ok[:, 0] + 1  # 1-D grid is offset by one lap
        return [[int(laps.min()), int(laps.max())]]
    cums = np.cumsum(ok, axis=1)
    return [[int(cums[:, i].min()), int(cums[:, i].max())] for i in range(stops)]


def _one_stop_curve(p, tables, total, best_time, pit_loss):
    """Modelled race time vs pit lap for the best 1-stop compound pair, both orders."""
    if p is None:
        return None
    a, b = p["seq"]
    laps = np.arange(1, total)
    out = {}
    for first, second in ((a, b), (b, a)):
        cost = tables[first][laps] + tables[second][total - laps] + pit_loss - best_time
        out[f"{first}>{second}"] = [round(float(x), 3) if np.isfinite(x) else None for x in cost]
    return {"laps": laps.tolist(), "series": out}


def evaluate_actual(laps: pd.DataFrame, model: DegModel, total: int, stops: list[dict],
                    loss_by_kind: dict[str, float], optimum: float) -> list[dict]:
    """Score each full-distance driver's real strategy with the same model.

    Uses real tyre ages (including used sets at the start) and charges each
    stop the median loss for its conditions (green, SC or VSC).
    """
    out = []
    by_driver = {}
    for s in stops:
        by_driver.setdefault(s["driver"], []).append(s)
    for driver, g in laps.groupby("driver", sort=False):
        if g["lap"].max() < total:
            continue
        g = g[g["lap"] <= total]
        if not g["compound"].isin(list(model.compounds)).all() or g["age"].isna().any():
            continue
        tyre = float(sum(
            model.compounds[c].cost(a) for c, a in zip(g["compound"], g["age"], strict=True)
        ))
        pits = [s for s in by_driver.get(driver, []) if s["new_set"]]
        pit = sum(loss_by_kind.get(s["kind"], loss_by_kind["GREEN"]) for s in pits)
        seq = [
            {"compound": s["compound"].iat[0], "laps": len(s)}
            for _, s in g.groupby(g["stint"].ffill().fillna(1), sort=True)
        ]
        out.append({
            "driver": driver,
            "stints": seq,
            "stops": len(pits),
            "stop_kinds": [s["kind"] for s in pits],
            "delta": round(tyre + pit - optimum, 3),
        })
    out.sort(key=lambda r: r["delta"])
    return out
