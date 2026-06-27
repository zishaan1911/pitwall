"""
F1 Race Strategy & Tire Degradation Simulator
FastAPI backend with physics-based tire model, pit window optimization,
and predictive lap time regression.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.stats import linregress
from typing import Optional
import math
import random

app = FastAPI(title="F1 Strategy Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# CONSTANTS & PHYSICS MODEL
# ─────────────────────────────────────────────

COMPOUND_PARAMS = {
    "SOFT": {
        "base_grip": 1.000,
        "deg_rate": 0.0045,
        "deg_exponent": 1.6,
        "optimal_window": (80, 100),  # °C
        "thermal_cliff": 35,  # lap where cliff begins
        "color": "#E8002D",
    },
    "MEDIUM": {
        "base_grip": 0.985,
        "deg_rate": 0.0028,
        "deg_exponent": 1.4,
        "optimal_window": (75, 95),
        "thermal_cliff": 55,
        "color": "#FFF200",
    },
    "HARD": {
        "base_grip": 0.972,
        "deg_rate": 0.0018,
        "deg_exponent": 1.2,
        "optimal_window": (70, 90),
        "thermal_cliff": 70,
        "color": "#FFFFFF",
    },
}

TRACK_PARAMS = {
    "Bahrain": {
        "base_lap": 93.0,
        "fuel_effect": 0.065,
        "track_temp_base": 42,
        "abrasiveness": 1.15,
        "total_laps": 57,
    },
    "Monaco": {
        "base_lap": 74.5,
        "fuel_effect": 0.035,
        "track_temp_base": 38,
        "abrasiveness": 0.85,
        "total_laps": 78,
    },
    "Spa": {
        "base_lap": 105.0,
        "fuel_effect": 0.08,
        "track_temp_base": 28,
        "abrasiveness": 0.90,
        "total_laps": 44,
    },
    "Silverstone": {
        "base_lap": 90.0,
        "fuel_effect": 0.070,
        "track_temp_base": 32,
        "abrasiveness": 1.05,
        "total_laps": 52,
    },
    "Monza": {
        "base_lap": 81.5,
        "fuel_effect": 0.060,
        "track_temp_base": 34,
        "abrasiveness": 0.80,
        "total_laps": 53,
    },
}

PIT_STOP_LOSS = 22.0  # seconds lost in a standard pit stop


# ─────────────────────────────────────────────
# TIRE DEGRADATION MODEL
# ─────────────────────────────────────────────

def tire_grip(lap: int, compound: str, track_temp: float, track: str) -> float:
    """
    Non-linear grip decay model.
    grip = base_grip * (1 - deg_rate * lap^exponent) * thermal_factor * abrasion_factor
    """
    p = COMPOUND_PARAMS[compound]
    tp = TRACK_PARAMS[track]

    # Base exponential degradation
    deg = p["deg_rate"] * (lap ** p["deg_exponent"]) * tp["abrasiveness"]

    # Thermal window penalty
    opt_low, opt_high = p["optimal_window"]
    if track_temp < opt_low:
        thermal_penalty = (opt_low - track_temp) * 0.003
    elif track_temp > opt_high:
        thermal_penalty = (track_temp - opt_high) * 0.004
    else:
        thermal_penalty = 0.0

    # Thermal cliff (sudden drop after certain lap)
    cliff_lap = p["thermal_cliff"]
    if lap > cliff_lap:
        cliff_penalty = (lap - cliff_lap) * 0.008
    else:
        cliff_penalty = 0.0

    grip = p["base_grip"] * (1 - deg - thermal_penalty - cliff_penalty)
    return max(0.60, grip)


def lap_time_on_tire(lap_on_tire: int, compound: str, fuel_load: float,
                     track: str, track_temp: float) -> float:
    """
    Predict lap time given tire age, fuel load, compound, track.
    lap_time = base + fuel_penalty + tire_penalty
    """
    tp = TRACK_PARAMS[track]
    base = tp["base_lap"]

    # Fuel load penalty (heavier car = slower)
    fuel_penalty = fuel_load * tp["fuel_effect"]

    # Tire time loss from grip loss
    grip = tire_grip(lap_on_tire, compound, track_temp, track)
    grip_loss = 1.0 - grip
    tire_penalty = grip_loss * 18.0  # ~18s time loss at zero grip

    # Add small random variance (sensor noise)
    noise = random.gauss(0, 0.05)

    return base + fuel_penalty + tire_penalty + noise


# ─────────────────────────────────────────────
# PIT WINDOW OPTIMIZER (Dijkstra-style graph)
# ─────────────────────────────────────────────

def build_strategy_graph(
    total_laps: int,
    compounds: list[str],
    track: str,
    track_temp: float,
    fuel_per_lap: float,
    full_fuel: float,
) -> dict:
    """
    Dynamic programming over the race to find the minimum total race time
    strategy. State = (current_lap, tire_compound, tire_age).
    Returns optimal pit laps and compounds.
    """
    INF = float("inf")

    # dp[lap][compound][tire_age] = min_cumulative_race_time
    # Prune: max tire life = 50 laps
    MAX_AGE = 50

    # Represent state as (lap, compound_idx, age) -> best time
    n_compounds = len(compounds)
    comp_idx = {c: i for i, c in enumerate(compounds)}

    # dp[(lap, comp, age)] = (min_time, prev_state, action)
    dp = {}
    prev = {}

    # Start: lap 0, choose starting compound (age 0)
    for c in compounds:
        dp[(0, c, 0)] = (0.0, None, f"START_{c}")

    for lap in range(1, total_laps + 1):
        fuel_load = max(0, full_fuel - lap * fuel_per_lap)

        for c in compounds:
            for age in range(0, min(lap + 1, MAX_AGE)):
                state = (lap, c, age)
                best_time = INF
                best_prev = None
                best_action = None

                lap_t = lap_time_on_tire(age, c, fuel_load, track, track_temp)

                # Option 1: Continue on same tire (age += 1)
                prev_state = (lap - 1, c, age - 1)
                if age > 0 and prev_state in dp:
                    candidate = dp[prev_state][0] + lap_t
                    if candidate < best_time:
                        best_time = candidate
                        best_prev = prev_state
                        best_action = "CONTINUE"

                # Option 2: Pit in from any other state last lap (age = 1 means just pitted)
                if age == 1:
                    for c_prev in compounds:
                        for age_prev in range(1, MAX_AGE):
                            p_state = (lap - 1, c_prev, age_prev)
                            if p_state in dp:
                                pit_lap_t = lap_time_on_tire(
                                    1, c, fuel_load, track, track_temp
                                )
                                candidate = (
                                    dp[p_state][0] + PIT_STOP_LOSS + pit_lap_t
                                )
                                if candidate < best_time:
                                    best_time = candidate
                                    best_prev = p_state
                                    best_action = f"PIT_TO_{c}"

                if best_time < INF:
                    dp[state] = (best_time, best_prev, best_action)
                    prev[state] = (best_prev, best_action)

    # Find best finishing state
    best_finish_time = INF
    best_finish_state = None
    for c in compounds:
        for age in range(1, MAX_AGE):
            state = (total_laps, c, age)
            if state in dp and dp[state][0] < best_finish_time:
                best_finish_time = dp[state][0]
                best_finish_state = state

    if best_finish_state is None:
        return {"error": "No valid strategy found"}

    # Trace back the optimal path
    path = []
    state = best_finish_state
    while state is not None and state in dp:
        _, p_state, action = dp[state]
        path.append((state, action))
        state = p_state

    path.reverse()

    # Extract pit stops
    pit_stops = []
    stints = []
    current_stint_start = 1
    current_compound = path[0][0][1]

    for state, action in path[1:]:
        lap, compound, age = state
        if action and action.startswith("PIT_TO_"):
            pit_stops.append({
                "lap": lap - 1,
                "from_compound": current_compound,
                "to_compound": compound,
            })
            stints.append({
                "start_lap": current_stint_start,
                "end_lap": lap - 1,
                "compound": current_compound,
                "laps": lap - 1 - current_stint_start + 1,
            })
            current_stint_start = lap
            current_compound = compound

    stints.append({
        "start_lap": current_stint_start,
        "end_lap": total_laps,
        "compound": current_compound,
        "laps": total_laps - current_stint_start + 1,
    })

    return {
        "total_time": best_finish_time,
        "pit_stops": pit_stops,
        "stints": stints,
    }


# ─────────────────────────────────────────────
# PREDICTIVE LAP TIME MODEL (regression)
# ─────────────────────────────────────────────

def clean_and_predict_pace(lap_times: list[float], flags: list[str]) -> dict:
    """
    Strip anomalous laps (SC, VSC, yellow) and fit linear regression
    to find underlying true race pace.
    """
    clean = [(i + 1, t) for i, (t, f) in enumerate(zip(lap_times, flags))
             if f == "GREEN" and t > 0]

    if len(clean) < 3:
        return {"error": "Insufficient clean laps"}

    laps_arr = np.array([x[0] for x in clean])
    times_arr = np.array([x[1] for x in clean])

    # Remove statistical outliers (>2 std dev)
    mean, std = times_arr.mean(), times_arr.std()
    mask = np.abs(times_arr - mean) < 2 * std
    laps_clean = laps_arr[mask]
    times_clean = times_arr[mask]

    slope, intercept, r_value, p_value, std_err = linregress(laps_clean, times_clean)

    # Predict future laps
    future_laps = np.arange(laps_clean[-1] + 1, laps_clean[-1] + 11)
    predicted = intercept + slope * future_laps

    return {
        "true_pace": float(np.median(times_clean)),
        "degradation_per_lap": float(slope),
        "r_squared": float(r_value ** 2),
        "predicted_laps": future_laps.tolist(),
        "predicted_times": predicted.tolist(),
        "clean_lap_count": int(mask.sum()),
        "anomalous_lap_count": int(len(lap_times) - mask.sum()),
    }


# ─────────────────────────────────────────────
# SIMULATED RACE DATA GENERATOR
# ─────────────────────────────────────────────

def generate_race_state(track: str, current_lap: int) -> dict:
    """
    Generate a realistic simulated race state with multiple drivers.
    In production this would pull from FastF1 live timing API.
    """
    tp = TRACK_PARAMS[track]
    total_laps = tp["total_laps"]
    track_temp = tp["track_temp_base"] + random.gauss(0, 2)

    # Simulate a 6-car field
    drivers = [
        {"name": "VER", "team": "Red Bull", "car_number": 1},
        {"name": "HAM", "team": "Mercedes", "car_number": 44},
        {"name": "LEC", "team": "Ferrari", "car_number": 16},
        {"name": "NOR", "team": "McLaren", "car_number": 4},
        {"name": "ALO", "team": "Aston Martin", "car_number": 14},
        {"name": "SAI", "team": "Ferrari", "car_number": 55},
    ]

    strategies = [
        {"compound": "MEDIUM", "pit_lap": 28, "second_compound": "HARD"},
        {"compound": "SOFT", "pit_lap": 20, "second_compound": "MEDIUM"},
        {"compound": "MEDIUM", "pit_lap": 30, "second_compound": "HARD"},
        {"compound": "SOFT", "pit_lap": 18, "second_compound": "HARD"},
        {"compound": "HARD", "pit_lap": 35, "second_compound": "MEDIUM"},
        {"compound": "MEDIUM", "pit_lap": 26, "second_compound": "SOFT"},
    ]

    race_data = []
    gap_to_leader = 0.0

    for i, (driver, strat) in enumerate(zip(drivers, strategies)):
        has_pitted = current_lap > strat["pit_lap"]
        if has_pitted:
            current_compound = strat["second_compound"]
            tire_age = current_lap - strat["pit_lap"]
        else:
            current_compound = strat["compound"]
            tire_age = current_lap

        fuel_load = max(0, 110 - current_lap * (110 / total_laps))
        current_grip = tire_grip(tire_age, current_compound, track_temp, track)

        current_lap_time = lap_time_on_tire(
            tire_age, current_compound, fuel_load, track, track_temp
        )

        # Generate lap history
        lap_times = []
        flags = []
        for lap in range(1, current_lap + 1):
            if lap > strat["pit_lap"]:
                c = strat["second_compound"]
                age = lap - strat["pit_lap"]
            else:
                c = strat["compound"]
                age = lap

            fl = max(0, 110 - lap * (110 / total_laps))
            lt = lap_time_on_tire(age, c, fl, track, track_temp)

            # Introduce occasional safety car laps
            if lap in [12, 13] and random.random() < 0.3:
                lt += 30
                flag = "SC"
            else:
                flag = "GREEN"

            lap_times.append(lt)
            flags.append(flag)

        pace_model = clean_and_predict_pace(lap_times, flags)

        # Cumulative gap calculation (simplified)
        gap_to_leader += i * random.uniform(0.3, 0.8) if i > 0 else 0

        # Undercut threat analysis
        undercut_threat = None
        if not has_pitted and current_lap > strat["pit_lap"] - 5:
            undercut_benefit = (
                tire_grip(1, strat["second_compound"], track_temp, track)
                - current_grip
            ) * 18.0
            if undercut_benefit > 1.5:
                undercut_threat = {
                    "laps_until_window": max(0, strat["pit_lap"] - current_lap),
                    "estimated_benefit_s": round(undercut_benefit, 2),
                }

        race_data.append({
            "driver": driver["name"],
            "team": driver["team"],
            "car_number": driver["car_number"],
            "position": i + 1,
            "current_compound": current_compound,
            "tire_age": tire_age,
            "current_grip_pct": round(current_grip * 100, 1),
            "current_lap_time": round(current_lap_time, 3),
            "gap_to_leader": round(gap_to_leader, 3),
            "has_pitted": has_pitted,
            "pit_lap": strat["pit_lap"],
            "fuel_load": round(fuel_load, 1),
            "lap_times": [round(t, 3) for t in lap_times],
            "lap_flags": flags,
            "pace_model": pace_model,
            "undercut_threat": undercut_threat,
            "compound_color": COMPOUND_PARAMS[current_compound]["color"],
        })

    return {
        "track": track,
        "current_lap": current_lap,
        "total_laps": total_laps,
        "track_temp": round(track_temp, 1),
        "drivers": race_data,
    }


# ─────────────────────────────────────────────
# API ROUTES
# ─────────────────────────────────────────────

class StrategyRequest(BaseModel):
    track: str
    compounds: list[str]
    track_temp: Optional[float] = None
    fuel_per_lap: Optional[float] = 2.0
    full_fuel: Optional[float] = 110.0


class TireDegradationRequest(BaseModel):
    compound: str
    track: str
    track_temp: Optional[float] = None
    max_laps: Optional[int] = 50


@app.get("/")
def root():
    return {"status": "F1 Strategy Engine online", "version": "1.0.0"}


@app.get("/tracks")
def get_tracks():
    return {
        "tracks": [
            {
                "name": name,
                "total_laps": params["total_laps"],
                "base_lap_time": params["base_lap"],
                "track_temp": params["track_temp_base"],
            }
            for name, params in TRACK_PARAMS.items()
        ]
    }


@app.get("/race-state/{track}/{lap}")
def get_race_state(track: str, lap: int):
    if track not in TRACK_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown track: {track}")
    total = TRACK_PARAMS[track]["total_laps"]
    if lap < 1 or lap > total:
        raise HTTPException(status_code=400, detail=f"Lap must be between 1 and {total}")
    return generate_race_state(track, lap)


@app.post("/optimize-strategy")
def optimize_strategy(req: StrategyRequest):
    if req.track not in TRACK_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown track: {req.track}")
    for c in req.compounds:
        if c not in COMPOUND_PARAMS:
            raise HTTPException(status_code=400, detail=f"Unknown compound: {c}")

    tp = TRACK_PARAMS[req.track]
    track_temp = req.track_temp or tp["track_temp_base"]

    result = build_strategy_graph(
        total_laps=tp["total_laps"],
        compounds=req.compounds,
        track=req.track,
        track_temp=track_temp,
        fuel_per_lap=req.fuel_per_lap,
        full_fuel=req.full_fuel,
    )
    result["track"] = req.track
    result["total_laps"] = tp["total_laps"]
    result["compounds_available"] = req.compounds
    return result


@app.post("/tire-degradation")
def tire_degradation_curve(req: TireDegradationRequest):
    if req.compound not in COMPOUND_PARAMS:
        raise HTTPException(status_code=400, detail=f"Unknown compound: {req.compound}")
    if req.track not in TRACK_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown track: {req.track}")

    tp = TRACK_PARAMS[req.track]
    track_temp = req.track_temp or tp["track_temp_base"]

    laps = list(range(0, req.max_laps + 1))
    grip_values = [tire_grip(lap, req.compound, track_temp, req.track) for lap in laps]
    time_penalty = [round((1 - g) * 18.0, 3) for g in grip_values]

    return {
        "compound": req.compound,
        "track": req.track,
        "track_temp": track_temp,
        "laps": laps,
        "grip_pct": [round(g * 100, 2) for g in grip_values],
        "time_penalty_s": time_penalty,
        "cliff_lap": COMPOUND_PARAMS[req.compound]["thermal_cliff"],
        "color": COMPOUND_PARAMS[req.compound]["color"],
    }


@app.get("/compounds")
def get_compounds():
    return {
        "compounds": [
            {
                "name": name,
                "color": params["color"],
                "deg_rate": params["deg_rate"],
                "thermal_cliff": params["thermal_cliff"],
                "base_grip": params["base_grip"],
            }
            for name, params in COMPOUND_PARAMS.items()
        ]
    }
