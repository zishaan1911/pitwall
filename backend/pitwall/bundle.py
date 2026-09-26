"""Build the analysis bundle for one session.

A bundle is a directory of plain JSON that the dashboard reads:

    <year>/<round>-<R|S>/session.json     timing, conditions, models
    <year>/<round>-<R|S>/tel/<CODE>.json  fastest-lap telemetry per driver

The API serves these on demand and the static exporter writes them ahead of
time for GitHub Pages. The files are identical in both cases.
"""

from __future__ import annotations

import json
import math
import shutil
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd

from . import __version__
from .analysis import battles, degradation, pitstops, strategy, telemetry
from .analysis.laps import WET, lap_at, leader_lap_ends, normalise, stints
from .sources import f1, jolpica, meteo, openf1

COMPOUND_CODE = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}
STATUS_KIND = {"2": "YELLOW", "4": "SC", "5": "RED", "6": "VSC", "7": "VSC"}


def session_dir(root: Path, year: int, round_: int, kind: str) -> Path:
    return root / str(year) / f"{round_:02d}-{kind}"


def jsonable(obj):
    """Convert numpy/pandas scalars and NaN to plain JSON values."""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if math.isnan(f) or math.isinf(f) else f
    if obj is pd.NaT or obj is None:
        return None
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    return obj


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(jsonable(data), separators=(",", ":"), allow_nan=False),
                    encoding="utf-8")


def _r(x, nd=3):
    return None if x is None or pd.isna(x) else round(float(x), nd)


def build(year: int, round_: int, kind: str, root: Path) -> Path:
    """Load a session from all sources, run the models and write the bundle."""
    session = f1.load(year, round_, kind)
    target = session_dir(root, year, round_, kind)
    tmp = Path(tempfile.mkdtemp(prefix="pitwall-", dir=root))
    try:
        _build_into(session, year, round_, kind, tmp)
        _swap(tmp, target)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return target


def _swap(tmp: Path, target: Path) -> None:
    """Move a finished bundle into place.

    A rename keeps readers from seeing a half-written bundle. On Windows it can
    be refused while a file watcher or scanner holds a handle on the old
    directory, so retry, then fall back to copying over it.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(6):
        try:
            if target.exists():
                shutil.rmtree(target)
            tmp.replace(target)
            return
        except PermissionError:
            time.sleep(0.5 * (attempt + 1))
    shutil.copytree(tmp, target, dirs_exist_ok=True)


def _build_into(session, year: int, round_: int, kind: str, out: Path) -> None:
    sources: dict[str, dict] = {"fastf1": {"ok": True, "version": fastf1.__version__}}
    laps = normalise(session.laps)
    # Laps actually run, which is fewer than scheduled if the race was shortened.
    total = int(laps["lap"].max())
    scheduled = int(getattr(session, "total_laps", None) or total)
    ends = leader_lap_ends(laps)
    t0: datetime = session.t0_date.to_pydatetime()
    start_s = float(laps["start"].min())
    end_s = float(laps["end"].max())
    start_utc = t0 + timedelta(seconds=start_s)
    end_utc = t0 + timedelta(seconds=end_s)

    # ---- drivers ---------------------------------------------------------
    res = session.results
    drivers = []
    numbers: dict[str, str] = {}
    for _, r in res.iterrows():
        code = str(r["Abbreviation"])
        numbers[code] = str(r["DriverNumber"])
        color = str(r.get("TeamColor") or "")
        drivers.append({
            "code": code,
            "number": str(r["DriverNumber"]),
            "name": str(r["FullName"]),
            "team": str(r["TeamName"]),
            "color": f"#{color}" if len(color) == 6 else "#8a93a0",
            "grid": None if pd.isna(r["GridPosition"]) or r["GridPosition"] == 0
            else int(r["GridPosition"]),
            "position": None if pd.isna(r["Position"]) else int(r["Position"]),
            "classified": str(r.get("ClassifiedPosition") or ""),
            "status": str(r["Status"]),
            "points": _r(r["Points"], 1),
            "laps": None if pd.isna(r.get("Laps")) else int(r["Laps"]),
        })
    by_number = {v: k for k, v in numbers.items()}
    present = set(laps["driver"])
    drivers = [d for d in drivers if d["code"] in present]

    # ---- laps (columnar per driver) --------------------------------------
    lap_table = {}
    for code, g in laps.groupby("driver", sort=False):
        g = g.sort_values("lap")
        lap_table[code] = {
            "lap": g["lap"].tolist(),
            "time": [_r(x) for x in g["time"]],
            "end": [_r(x) for x in g["end"]],
            "pos": [None if pd.isna(x) else int(x) for x in g["position"]],
            "compound": [COMPOUND_CODE.get(c, "U") for c in g["compound"]],
            "age": [None if pd.isna(x) else int(x) for x in g["age"]],
            "pit_in": g["pit_in"].astype(int).tolist(),
            "pit_out": g["pit_out"].astype(int).tolist(),
            "status": g["status"].tolist(),
            "clean": g["clean"].astype(int).tolist(),
            "s1": [_r(x) for x in g["s1"]],
            "s2": [_r(x) for x in g["s2"]],
            "s3": [_r(x) for x in g["s3"]],
            "trap": [None if pd.isna(x) else int(x) for x in g["speed_trap"]],
        }

    # ---- track status -------------------------------------------------------
    status_periods = []
    ts = session.track_status
    if ts is not None and not ts.empty:
        rows = list(ts.itertuples(index=False))
        for i, row in enumerate(rows):
            kind_ = STATUS_KIND.get(str(row.Status))
            if not kind_:
                continue
            t_start = row.Time.total_seconds()
            t_end = rows[i + 1].Time.total_seconds() if i + 1 < len(rows) else end_s
            if status_periods and status_periods[-1]["kind"] == kind_ \
                    and abs(status_periods[-1]["end"] - t_start) < 1:
                status_periods[-1]["end"] = t_end
                continue
            status_periods.append({"kind": kind_, "start": t_start, "end": t_end})
        for p in status_periods:
            p["lap_start"], p["lap_end"] = (int(x) for x in lap_at([p["start"], p["end"]], ends))
            p["start"], p["end"] = round(p["start"], 1), round(p["end"], 1)

    # ---- weather (trackside) ----------------------------------------------
    w = session.weather_data
    weather = None
    if w is not None and not w.empty:
        wt = w["Time"].dt.total_seconds()
        keep = (wt >= start_s - 900) & (wt <= end_s + 300)
        w, wt = w[keep], wt[keep]
        weather = {
            "t": wt.round(1).tolist(),
            "lap": lap_at(wt.to_numpy(), ends).tolist(),
            "air": w["AirTemp"].round(1).tolist(),
            "track": w["TrackTemp"].round(1).tolist(),
            "humidity": w["Humidity"].round(1).tolist(),
            "pressure": w["Pressure"].round(1).tolist(),
            "wind_speed": w["WindSpeed"].round(1).tolist(),
            "wind_dir": w["WindDirection"].astype(int).tolist(),
            "rain": w["Rainfall"].astype(bool).astype(int).tolist(),
        }

    # ---- race control ------------------------------------------------------
    race_control = []
    rcm = session.race_control_messages
    if rcm is not None and not rcm.empty:
        for _, m in rcm.iterrows():
            t = (m["Time"].to_pydatetime() - t0).total_seconds()
            if t < start_s - 3600:
                continue
            racing_no = m.get("RacingNumber")
            race_control.append({
                "t": round(t, 1),
                "lap": None if pd.isna(m.get("Lap")) else int(m["Lap"]),
                "category": str(m["Category"]),
                "flag": None if pd.isna(m.get("Flag")) else str(m["Flag"]),
                "scope": None if pd.isna(m.get("Scope")) else str(m["Scope"]),
                "sector": None if pd.isna(m.get("Sector")) else int(m["Sector"]),
                "driver": by_number.get(str(racing_no)) if racing_no else None,
                "message": str(m["Message"]),
            })

    # ---- models ------------------------------------------------------------
    model = degradation.fit(laps)
    wet_race = bool(laps["compound"].isin(WET).mean() > 0.1)

    openf1_pits, radio, overtakes = [], [], []
    try:
        key = openf1.find_session_key(year, f1.SESSION_NAMES[kind], start_utc)
        if key is None:
            raise LookupError("session not found in OpenF1")
        openf1_pits = openf1.pit(key)
        radio_raw = openf1.team_radio(key)
        overtakes = openf1.overtakes(key)
        for r in radio_raw:
            t = (openf1.to_naive_utc(r["date"]) - t0).total_seconds()
            if t < start_s - 1800 or t > end_s + 900:
                continue
            radio.append({
                "t": round(t, 1),
                "lap": int(lap_at(t, ends)) if t >= start_s else 0,
                "driver": by_number.get(str(r["driver_number"])),
                "url": r["recording_url"],
            })
        sources["openf1"] = {"ok": True, "session_key": key, "pit": len(openf1_pits),
                             "radio": len(radio), "overtakes": len(overtakes)}
    except Exception as exc:  # noqa: BLE001
        sources["openf1"] = {"ok": False, "error": _err(exc)}

    stop_rows = pitstops.ledger(laps, model, openf1_pits, numbers)
    loss = pitstops.summary(stop_rows)
    plan = None
    actual = []
    # Sprints have no mandatory stop, so a race strategy optimiser does not apply.
    if kind == "R" and model is not None and "GREEN" in loss:
        plan = strategy.optimise(model, total, loss["GREEN"]["median"], wet=wet_race)
        if plan:
            by_kind = {k: v["median"] for k, v in loss.items() if isinstance(v, dict)}
            by_kind["RED"] = 0.0  # tyres may be changed for free while the race is suspended
            actual = strategy.evaluate_actual(laps, model, total, stop_rows, by_kind,
                                              plan.pop("reference_time"))
    undercuts = battles.ledger(laps, stop_rows)

    passes = {}
    for o in overtakes:
        for key_, role in (("overtaking_driver_number", "made"),
                           ("overtaken_driver_number", "lost")):
            code = by_number.get(str(o.get(key_)))
            if code:
                passes.setdefault(code, {"made": 0, "lost": 0})[role] += 1

    # ---- circuit, weather reanalysis, championship -----------------------
    circuit_meta = None
    try:
        circuit_meta = jolpica.circuit(year, round_)
        sources["jolpica"] = {"ok": circuit_meta is not None}
    except Exception as exc:  # noqa: BLE001
        sources["jolpica"] = {"ok": False, "error": _err(exc)}

    standings: dict[str, list] = {"before": [], "after": []}
    if kind == "R":
        try:
            standings = {
                "before": jolpica.standings_before(year, round_),
                "after": jolpica.standings_after(year, round_),
            }
        except Exception as exc:  # noqa: BLE001
            sources["jolpica"] = {"ok": False, "error": _err(exc)}

    hourly = None
    if circuit_meta:
        try:
            hourly = meteo.hourly(circuit_meta["lat"], circuit_meta["lon"], start_utc, end_utc)
            sources["open_meteo"] = {"ok": True, "dataset": hourly.pop("source")}
        except Exception as exc:  # noqa: BLE001
            sources["open_meteo"] = {"ok": False, "error": _err(exc)}

    # ---- telemetry -----------------------------------------------------------
    tel_index = []
    fastest = None
    for d in drivers:
        tel = telemetry.fastest_lap(session, d["code"])
        if tel is None:
            continue
        _write(out / "tel" / f"{d['code']}.json", tel)
        tel_index.append({"driver": d["code"], "lap": tel["lap"], "lap_time": tel["lap_time"]})
        if fastest is None or tel["lap_time"] < fastest["lap_time"]:
            fastest = tel
    track = telemetry.circuit(session, fastest)

    ev = session.event
    meta = {
        "year": year,
        "round": round_,
        "kind": kind,
        "session": f1.SESSION_NAMES[kind],
        "event": ev["EventName"],
        "official_name": ev.get("OfficialEventName"),
        "country": ev["Country"],
        "location": ev["Location"],
        "circuit": circuit_meta,
        "date": ev["EventDate"].date().isoformat(),
        "start_utc": start_utc.isoformat() + "Z",
        "end_utc": end_utc.isoformat() + "Z",
        "start_s": round(start_s, 1),
        "end_s": round(end_s, 1),
        "total_laps": total,
        "scheduled_laps": scheduled,
        "wet": wet_race,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pitwall": __version__,
        "sources": sources,
    }

    _write(out / "session.json", {
        "meta": meta,
        "drivers": drivers,
        "laps": lap_table,
        "leader_ends": [round(float(x), 3) for x in ends],
        "stints": stints(laps),
        "track_status": status_periods,
        "weather": weather,
        "weather_hourly": hourly,
        "race_control": race_control,
        "radio": radio,
        "passes": passes,
        "pit_stops": stop_rows,
        "pit_loss": loss,
        "model": model.to_json() if model else None,
        "strategy": plan,
        "actual_strategies": actual,
        "undercuts": undercuts,
        "standings": standings,
        "track": track,
        "telemetry": tel_index,
    })


def _err(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:300]

