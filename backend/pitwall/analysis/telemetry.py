"""Car telemetry for each driver's fastest lap, plus the circuit geometry."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _fastest(session, driver: str):
    laps = session.laps.pick_drivers(driver)
    if laps.empty:
        return None
    lap = laps.pick_fastest(only_by_time=True)
    if lap is None or (hasattr(lap, "empty") and lap.empty) or pd.isna(lap["LapTime"]):
        return None
    return lap


def fastest_lap(session, driver: str) -> dict | None:
    lap = _fastest(session, driver)
    if lap is None:
        return None
    try:
        tel = lap.get_telemetry()
    except Exception:  # noqa: BLE001 - FastF1 raises a variety of errors on missing data
        return None
    if tel.empty or "Distance" not in tel:
        return None
    return {
        "driver": driver,
        "lap": int(lap["LapNumber"]),
        "lap_time": float(lap["LapTime"].total_seconds()),
        "compound": str(lap["Compound"]),
        "tyre_age": None if pd.isna(lap["TyreLife"]) else int(lap["TyreLife"]),
        "d": np.round(tel["Distance"].to_numpy(float), 1).tolist(),
        "t": np.round(tel["Time"].dt.total_seconds().to_numpy(float), 3).tolist(),
        "speed": np.round(tel["Speed"].to_numpy(float)).astype(int).tolist(),
        "throttle": np.clip(np.round(tel["Throttle"].to_numpy(float)), 0, 100).astype(int).tolist(),
        "brake": tel["Brake"].astype(bool).astype(int).tolist(),
        "gear": tel["nGear"].fillna(0).astype(int).tolist(),
        "rpm": np.round(tel["RPM"].to_numpy(float), -1).astype(int).tolist(),
        # DRS channel: 10, 12 and 14 mean the flap is open
        "drs": (tel["DRS"].fillna(0).astype(int) >= 10).astype(int).tolist(),
        "x": np.round(tel["X"].to_numpy(float)).astype(int).tolist(),
        "y": np.round(tel["Y"].to_numpy(float)).astype(int).tolist(),
        "z": np.round(tel["Z"].to_numpy(float)).astype(int).tolist(),
    }


def circuit(session, reference: dict | None) -> dict | None:
    """Track outline, elevation profile and corner markers.

    FastF1 positions are in 1/10 m, so elevation is reported in metres.
    """
    if reference is None:
        return None
    try:
        info = session.get_circuit_info()
    except Exception:  # noqa: BLE001
        info = None
    corners = []
    rotation = 0.0
    if info is not None:
        rotation = float(info.rotation)
        for _, c in info.corners.iterrows():
            corners.append({
                "number": int(c["Number"]),
                "letter": str(c["Letter"] or ""),
                "x": round(float(c["X"])),
                "y": round(float(c["Y"])),
                "angle": round(float(c["Angle"]), 1),
                "distance": round(float(c["Distance"]), 1),
            })
    # Z is noisy sample to sample; smooth lightly before plotting the profile.
    z = pd.Series(reference["z"], dtype=float).rolling(7, center=True, min_periods=1).median()
    z = z.rolling(7, center=True, min_periods=1).mean().to_numpy() / 10.0
    return {
        "x": reference["x"],
        "y": reference["y"],
        "d": reference["d"],
        "elevation": np.round(z - z.min(), 2).tolist(),
        "length": reference["d"][-1],
        "rotation": rotation,
        "corners": corners,
    }
