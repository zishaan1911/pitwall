import math

import numpy as np
import pytest

from pitwall.analysis import battles, degradation, pitstops, strategy
from pitwall.bundle import jsonable

from .conftest import STRATEGIES, TRUTH, race_laps


def test_clean_laps_exclude_lap_one_pits_and_safety_car():
    df = race_laps(STRATEGIES, sc_laps=(10, 11))
    dirty = df[~df["clean"]]
    assert (dirty["lap"] == 1).sum() == len(STRATEGIES)
    assert dirty["pit_in"].sum() == df["pit_in"].sum()
    assert dirty["pit_out"].sum() == df["pit_out"].sum()
    assert set(dirty.loc[dirty["lap"].isin([10, 11]), "status"]) == {"4"}
    assert not df.loc[df["clean"], "neutralised"].any()


def test_degradation_recovers_true_parameters(laps):
    model = degradation.fit(laps)
    assert model is not None
    assert model.reference == "HARD"
    for c in ("HARD", "MEDIUM"):
        fit = model.compounds[c]
        assert fit.lin == pytest.approx(TRUTH["lin"][c], abs=4 * fit.lin_se + 0.004)
        assert not fit.quadratic  # truth is linear; the quadratic term must be rejected
    med = model.compounds["MEDIUM"]
    assert med.offset == pytest.approx(TRUTH["offset"]["MEDIUM"], abs=4 * med.offset_se + 0.02)
    assert model.lap_coef == pytest.approx(TRUTH["delta"], abs=4 * model.lap_se + 0.003)
    # Driver ordering and gaps survive the correction.
    pace = {p: mu - model.driver_mu["AAA"] for p, mu in model.driver_mu.items()}
    for d, mu in TRUTH["mu"].items():
        assert pace[d] == pytest.approx(mu - TRUTH["mu"]["AAA"], abs=0.08)


def test_robust_fit_flags_traffic_laps(laps):
    model = degradation.fit(laps)
    assert model.downweighted >= 15  # 25 laps got +3 s; most sit beyond 2.7 sigma
    assert model.sigma < 0.2  # noise is 0.12 s; outliers must not inflate it


def test_degradation_needs_data():
    df = race_laps({"AAA": [("MEDIUM", 5), ("HARD", 5)]}, total=10)
    assert degradation.fit(df) is None


def test_pit_loss_is_measured_against_model(laps):
    model = degradation.fit(laps)
    stops = pitstops.ledger(laps, model)
    assert len(stops) == 5  # AAA, BBB, CCC one stop each; DDD two
    assert all(s["kind"] == "GREEN" and s["new_set"] for s in stops)
    summary = pitstops.summary(stops)
    assert summary["GREEN"]["median"] == pytest.approx(22.0, abs=0.6)


def test_safety_car_stops_are_classified_separately():
    df = race_laps({"AAA": [("MEDIUM", 20), ("HARD", 30)], "BBB": [("MEDIUM", 25), ("HARD", 25)],
                    "CCC": [("HARD", 30), ("MEDIUM", 20)], "DDD": [("MEDIUM", 20), ("HARD", 30)]},
                   sc_laps=(20, 21))
    stops = pitstops.ledger(df, degradation.fit(df))
    by_key = {(s["driver"], s["lap"]): s for s in stops}
    assert by_key[("AAA", 20)]["kind"] == "SC"
    assert by_key[("BBB", 25)]["kind"] == "GREEN"
    # Measured against the cars that stayed out under the SC, not green-flag pace,
    # so the slow SC laps are not counted as pit loss.
    assert by_key[("AAA", 20)]["loss"] == pytest.approx(22.0, abs=1.0)
    assert by_key[("DDD", 20)]["loss"] == pytest.approx(22.0, abs=1.0)


def brute_force(model, total, loss, compounds):
    """Independent check: enumerate every 1- and 2-stop plan explicitly."""
    best = math.inf
    cost = {c: np.cumsum([0.0] + [model.compounds[c].cost(a) for a in range(1, total + 1)])
            for c in compounds}
    cap = {c: model.compounds[c].age_max + strategy.EXTRAPOLATE for c in compounds}
    lo = strategy.MIN_STINT
    for a in compounds:
        for b in compounds:
            if a == b:
                continue
            for n in range(lo, total - lo + 1):
                if n <= cap[a] and total - n <= cap[b]:
                    best = min(best, cost[a][n] + cost[b][total - n] + loss)
            for c in compounds:
                for n1 in range(lo, total):
                    for n2 in range(lo, total - n1 - lo + 1):
                        n3 = total - n1 - n2
                        if n1 <= cap[a] and n2 <= cap[b] and lo <= n3 <= cap[c]:
                            best = min(best, cost[a][n1] + cost[b][n2] + cost[c][n3] + 2 * loss)
    return best


@pytest.mark.parametrize("loss", [12.0, 22.0, 40.0])
def test_optimiser_matches_brute_force(laps, loss):
    model = degradation.fit(laps)
    plan = strategy.optimise(model, 50, loss)
    reference = plan.pop("reference_time")
    best = plan["ranked"][0]
    assert sum(s["laps"] for s in best["stints"]) == 50
    assert len({s["compound"] for s in best["stints"]}) >= 2
    expected = brute_force(model, 50, loss, ["MEDIUM", "HARD"])
    if best["stops"] <= 2:
        assert reference == pytest.approx(expected, abs=1e-6)
    else:
        assert reference <= expected + 1e-6


def test_cheap_stops_mean_more_stops(laps):
    model = degradation.fit(laps)
    cheap = strategy.optimise(model, 50, 3.0)["ranked"][0]["stops"]
    dear = strategy.optimise(model, 50, 60.0)["ranked"][0]["stops"]
    assert cheap >= dear
    assert dear == 1


def test_optimiser_respects_observed_tyre_life(laps):
    model = degradation.fit(laps)
    plan = strategy.optimise(model, 50, 22.0)
    for p in plan["ranked"]:
        for s in p["stints"]:
            assert s["laps"] <= model.compounds[s["compound"]].age_max + strategy.EXTRAPOLATE


def test_pit_window_contains_optimum(laps):
    model = degradation.fit(laps)
    best = strategy.optimise(model, 50, 22.0)["best_by_stops"]["1"]
    (lo, hi), = best["window"]
    assert lo <= best["stints"][0]["laps"] <= hi


def test_actual_strategies_are_scored(laps):
    model = degradation.fit(laps)
    stops = pitstops.ledger(laps, model)
    plan = strategy.optimise(model, 50, 22.0)
    rows = strategy.evaluate_actual(laps, model, 50, stops, {"GREEN": 22.0},
                                    plan["reference_time"])
    assert {r["driver"] for r in rows} == set(STRATEGIES)
    assert all(r["delta"] >= -1e-6 for r in rows)  # nobody beats the modelled optimum
    ddd = next(r for r in rows if r["driver"] == "DDD")
    assert [s["laps"] for s in ddd["stints"]] == [15, 20, 15]


def test_undercut_ledger_detects_position_swap():
    # Equal pace; BBB starts 0.8 s behind AAA and stops two laps earlier, swapping
    # 28-lap-old mediums for new hards that are ~1.6 s/lap faster.
    df = race_laps({"AAA": [("MEDIUM", 30), ("HARD", 20)], "BBB": [("MEDIUM", 28), ("HARD", 22)],
                    "CCC": [("HARD", 25), ("MEDIUM", 25)], "DDD": [("MEDIUM", 20), ("HARD", 30)]},
                   noise=0.01, mu={"BBB": TRUTH["mu"]["AAA"]})
    model = degradation.fit(df)
    rows = battles.ledger(df, pitstops.ledger(df, model))
    pair = next(r for r in rows if r["early"] == "BBB" and r["late"] == "AAA")
    assert pair["gap_before"] == pytest.approx(0.8, abs=0.1)  # BBB was behind
    assert pair["gap_after"] < 0  # and came out ahead
    assert pair["verdict"] == "UNDERCUT"
    assert pair["gain"] == pytest.approx(pair["gap_before"] - pair["gap_after"])


def test_jsonable_strips_nan_and_numpy():
    out = jsonable({"a": np.float64("nan"), "b": np.int64(3), "c": [np.bool_(True), float("inf")]})
    assert out == {"a": None, "b": 3, "c": [True, None]}


def test_actual_strategy_charges_loss_by_conditions(laps):
    model = degradation.fit(laps)
    stops = pitstops.ledger(laps, model)
    ref = strategy.optimise(model, 50, 22.0)["reference_time"]
    green = {r["driver"]: r["delta"] for r in
             strategy.evaluate_actual(laps, model, 50, stops, {"GREEN": 22.0}, ref)}
    for s in stops:
        if s["driver"] == "AAA":
            s["kind"] = "RED"  # e.g. tyres changed during a red flag
    red = {r["driver"]: r["delta"] for r in
           strategy.evaluate_actual(laps, model, 50, stops, {"GREEN": 22.0, "RED": 0.0}, ref)}
    assert red["AAA"] == pytest.approx(green["AAA"] - 22.0)
    assert red["BBB"] == pytest.approx(green["BBB"])


def test_abnormal_stops_do_not_set_pit_loss(laps):
    stops = pitstops.ledger(laps, degradation.fit(laps))
    for s in stops:
        s["lane"], s["stationary"] = 20.0, 2.4
    baseline = pitstops.summary(stops)["GREEN"]
    slow = dict(stops[0], loss=45.0, lane=35.0)  # drive-through length: a penalty
    stuck = dict(stops[1], loss=40.0, stationary=9.0)  # wheel-nut problem
    opening = dict(stops[2], lap=1, loss=48.0)  # lap-1 damage stop
    for s in (slow, stuck, opening):
        assert not pitstops.is_normal(s, 20.0)
    assert pitstops.summary(stops + [slow, stuck, opening])["GREEN"] == baseline
