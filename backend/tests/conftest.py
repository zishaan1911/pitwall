"""Synthetic race data with known ground truth.

The frames match what `pitwall.analysis.laps.normalise` produces, so the
models can be tested without touching the network.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

TRUTH = {
    "mu": {"AAA": 90.0, "BBB": 90.4, "CCC": 90.9, "DDD": 91.3},
    "offset": {"HARD": 0.0, "MEDIUM": -0.45},
    "lin": {"HARD": 0.030, "MEDIUM": 0.070},
    "delta": -0.060,
}


def race_laps(
    strategies: dict[str, list[tuple[str, int]]],
    *,
    total: int = 50,
    noise: float = 0.12,
    outliers: int = 0,
    sc_laps: tuple[int, ...] = (),
    pit_loss: float = 22.0,
    seed: int = 1,
    mu: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Build a normalised lap table from per-driver (compound, stint length) plans."""
    rng = np.random.default_rng(seed)
    mu = {**TRUTH["mu"], **(mu or {})}
    rows = []
    for driver, plan in strategies.items():
        assert sum(n for _, n in plan) == total
        clock = 3600.0 + list(TRUTH["mu"]).index(driver) * 0.8
        lap = 0
        for stint_no, (compound, length) in enumerate(plan, start=1):
            for age in range(1, length + 1):
                lap += 1
                t = (
                    mu[driver]
                    + TRUTH["offset"][compound]
                    + TRUTH["lin"][compound] * age
                    + TRUTH["delta"] * lap
                    + rng.normal(0, noise)
                )
                status = "1"
                if lap in sc_laps:
                    t += 25.0
                    status = "4"
                pit_in = age == length and lap < total
                pit_out = age == 1 and stint_no > 1
                if pit_in:
                    t += pit_loss * 0.4
                if pit_out:
                    t += pit_loss * 0.6
                clock += t
                rows.append({
                    "driver": driver, "number": str(len(rows)), "lap": lap, "time": t,
                    "end": clock, "start": clock - t, "s1": t / 3, "s2": t / 3, "s3": t / 3,
                    "position": np.nan, "compound": compound, "age": float(age),
                    "stint": float(stint_no), "fresh": True, "pit_in": pit_in,
                    "pit_out": pit_out, "status": status, "accurate": True, "deleted": False,
                    "speed_trap": 300.0,
                })
    df = pd.DataFrame(rows)
    if outliers:
        candidates = df.index[(df["lap"] > 3) & ~df["pit_in"] & ~df["pit_out"]]
        idx = rng.choice(candidates, size=outliers, replace=False)
        df.loc[idx, "time"] += 3.0  # traffic
    df["neutralised"] = df["status"].isin(["4", "5", "6", "7"])
    from pitwall.analysis.laps import classify_clean

    df["clean"] = classify_clean(df)
    return df


STRATEGIES = {
    "AAA": [("MEDIUM", 18), ("HARD", 32)],
    "BBB": [("MEDIUM", 22), ("HARD", 28)],
    "CCC": [("HARD", 30), ("MEDIUM", 20)],
    "DDD": [("MEDIUM", 15), ("HARD", 20), ("MEDIUM", 15)],
}


@pytest.fixture
def laps() -> pd.DataFrame:
    return race_laps(STRATEGIES, outliers=25)
