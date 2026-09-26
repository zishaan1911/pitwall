"""Normalise FastF1 laps into one flat table and classify representative laps."""

from __future__ import annotations

import numpy as np
import pandas as pd

DRY = ("SOFT", "MEDIUM", "HARD")
WET = ("INTERMEDIATE", "WET")

# FastF1 track status codes: 1 green, 2 yellow, 4 safety car, 5 red flag,
# 6 VSC deployed, 7 VSC ending.
NEUTRALISED = set("4567")


def _seconds(series: pd.Series) -> pd.Series:
    return series.dt.total_seconds()


def normalise(laps: pd.DataFrame) -> pd.DataFrame:
    """One row per driver-lap with plain floats, seconds and booleans."""
    df = pd.DataFrame({
        "driver": laps["Driver"].astype(str),
        "number": laps["DriverNumber"].astype(str),
        "lap": laps["LapNumber"].astype(int),
        "time": _seconds(laps["LapTime"]),
        "end": _seconds(laps["Time"]),
        "start": _seconds(laps["LapStartTime"]),
        "s1": _seconds(laps["Sector1Time"]),
        "s2": _seconds(laps["Sector2Time"]),
        "s3": _seconds(laps["Sector3Time"]),
        "position": laps["Position"],
        "compound": laps["Compound"].fillna("UNKNOWN").astype(str).str.upper(),
        "age": laps["TyreLife"],
        "stint": laps["Stint"],
        "fresh": laps["FreshTyre"].astype("boolean").fillna(False).astype(bool),
        "pit_in": laps["PitInTime"].notna(),
        "pit_out": laps["PitOutTime"].notna(),
        "status": laps["TrackStatus"].fillna("").astype(str),
        "accurate": laps["IsAccurate"].astype("boolean").fillna(False).astype(bool),
        "deleted": laps["Deleted"].astype("boolean").fillna(False).astype(bool),
        "speed_trap": laps["SpeedST"],
    }).sort_values(["driver", "lap"]).reset_index(drop=True)
    df["neutralised"] = df["status"].map(lambda s: bool(set(s) & NEUTRALISED))
    df["clean"] = classify_clean(df)
    return df


def classify_clean(df: pd.DataFrame) -> pd.Series:
    """Laps that represent tyre-limited race pace.

    Excludes lap 1, in and out laps, any lap run under yellow/SC/VSC/red,
    laps FastF1 marks as inaccurate, and laps more than 5 s off the driver's
    median clean time (spins, damage, stuck in a train behind a backmarker).
    """
    ok = (
        (df["lap"] > 1)
        & ~df["pit_in"]
        & ~df["pit_out"]
        & df["accurate"]
        & df["time"].notna()
        & df["age"].notna()
        & df["compound"].isin(DRY + WET)
        & df["status"].map(lambda s: set(s) <= {"1"} and s != "")
    )
    median = df[ok].groupby("driver")["time"].transform("median")
    ok = ok & ~(df["time"] > median.reindex(df.index) + 5.0).fillna(False)
    return ok.fillna(False)


def stints(df: pd.DataFrame) -> list[dict]:
    """Tyre stints per driver, built from the laps themselves."""
    out = []
    for driver, g in df.groupby("driver", sort=False):
        g = g.sort_values("lap")
        key = g["stint"].ffill().fillna(1)
        for stint_no, s in g.groupby(key, sort=True):
            compound = s["compound"].mode().iat[0] if not s["compound"].mode().empty else "UNKNOWN"
            age0 = s["age"].dropna()
            out.append({
                "driver": driver,
                "stint": int(stint_no),
                "compound": compound,
                "lap_start": int(s["lap"].min()),
                "lap_end": int(s["lap"].max()),
                "laps": int(len(s)),
                "age_start": int(age0.iat[0]) if len(age0) else None,
                "fresh": bool(s["fresh"].iat[0]),
            })
    return out


def leader_lap_ends(df: pd.DataFrame) -> np.ndarray:
    """Session time at which the leader completed each lap (index = lap - 1)."""
    ends = df.groupby("lap")["end"].min().sort_index()
    return ends.to_numpy()


def lap_at(times: np.ndarray | float, leader_ends: np.ndarray) -> np.ndarray:
    """Race lap in progress at session time(s) `times` (1-based, clipped)."""
    idx = np.searchsorted(leader_ends, np.asarray(times, dtype=float), side="left") + 1
    return np.clip(idx, 1, len(leader_ends))
