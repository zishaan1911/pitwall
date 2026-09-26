"""Tyre degradation model fitted to clean race laps.

    t(i) = mu[driver] + kappa[compound] + b1[compound]*age + b2[compound]*age^2
           + delta*lap + e(i)

* mu: the driver/car's fuel- and tyre-corrected pace (a fixed effect)
* kappa: compound pace offset relative to the reference (most-run) compound
* b1, b2: per-compound wear curve against tyre age in laps
* delta: time change per race lap, which lumps together fuel burn-off and
  track rubbering-in. It separates from tyre age because age resets at each
  stop while lap count keeps rising.

Fitted by iteratively reweighted least squares with Huber weights, so traffic
laps and small mistakes are down-weighted instead of pulling the curve. The
quadratic term is kept only where the data supports it (t > 2, positive
curvature); otherwise that compound is linear.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

MIN_COMPOUND_LAPS = 15
MIN_DRIVER_LAPS = 5
HUBER_K = 1.345


@dataclass
class CompoundFit:
    offset: float
    offset_se: float
    lin: float
    lin_se: float
    quad: float = 0.0
    quad_se: float = 0.0
    quadratic: bool = False
    laps: int = 0
    age_min: int = 0
    age_max: int = 0

    def cost(self, age: np.ndarray | float) -> np.ndarray | float:
        """Lap-time delta vs a new reference tyre at this tyre age."""
        a = np.asarray(age, dtype=float)
        return self.offset + self.lin * a + self.quad * a * a


@dataclass
class DegModel:
    reference: str
    compounds: dict[str, CompoundFit]
    lap_coef: float
    lap_se: float
    driver_mu: dict[str, float]
    driver_se: dict[str, float]
    sigma: float
    rmse: float
    r2: float
    n: int
    downweighted: int
    points: list[dict] = field(default_factory=list)

    def predict(self, driver: str, compound: str, age: float, lap: float) -> float | None:
        fit = self.compounds.get(compound)
        mu = self.driver_mu.get(driver)
        if fit is None or mu is None:
            return None
        return float(mu + fit.cost(age) + self.lap_coef * lap)

    def to_json(self) -> dict:
        fastest = min(self.driver_mu.values())
        return {
            "reference": self.reference,
            "lap_coef": self.lap_coef,
            "lap_se": self.lap_se,
            "sigma": self.sigma,
            "rmse": self.rmse,
            "r2": self.r2,
            "n": self.n,
            "downweighted": self.downweighted,
            "compounds": {
                c: {
                    **f.__dict__,
                    "curve": [
                        round(float(f.cost(a)), 4) for a in range(1, f.age_max + 1)
                    ],
                }
                for c, f in self.compounds.items()
            },
            # Driver pace relative to the fastest, tyre and fuel corrected
            "driver_pace": sorted(
                (
                    {"driver": d, "delta": round(mu - fastest, 4),
                     "se": round(self.driver_se[d], 4)}
                    for d, mu in self.driver_mu.items()
                ),
                key=lambda r: r["delta"],
            ),
            "points": self.points,
        }


def _wls(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> np.ndarray:
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    return beta


def _irls(X: np.ndarray, y: np.ndarray, iters: int = 30) -> tuple[np.ndarray, np.ndarray]:
    w = np.ones(len(y))
    beta = _wls(X, y, w)
    for _ in range(iters):
        r = y - X @ beta
        scale = 1.4826 * np.median(np.abs(r - np.median(r))) or 1e-6
        u = np.abs(r) / (HUBER_K * scale)
        w_new = np.where(u <= 1, 1.0, 1.0 / np.maximum(u, 1e-12))
        beta_new = _wls(X, y, w_new)
        if np.allclose(beta_new, beta, atol=1e-7):
            beta, w = beta_new, w_new
            break
        beta, w = beta_new, w_new
    return beta, w


def fit(laps: pd.DataFrame) -> DegModel | None:
    d = laps[laps["clean"]].copy()
    counts = d["compound"].value_counts()
    d = d[d["compound"].isin(counts[counts >= MIN_COMPOUND_LAPS].index)]
    per_driver = d["driver"].value_counts()
    d = d[d["driver"].isin(per_driver[per_driver >= MIN_DRIVER_LAPS].index)]
    if len(d) < 40 or d["compound"].nunique() == 0:
        return None

    reference = d["compound"].value_counts().index[0]
    d = d[d["compound"].isin(_identifiable(d, reference))]
    compounds = list(d["compound"].value_counts().index)
    candidates = {
        c for c in compounds
        if (d["compound"] == c).sum() >= 60 and np.ptp(d.loc[d["compound"] == c, "age"]) >= 12
    }

    model = _fit_once(d, compounds, reference, candidates)
    keep = {
        c for c in candidates
        if model.compounds[c].quad > 0
        and model.compounds[c].quad > 2 * max(model.compounds[c].quad_se, 1e-12)
    }
    if keep != candidates:
        model = _fit_once(d, compounds, reference, keep)
    return model


def _identifiable(d: pd.DataFrame, reference: str) -> set[str]:
    """Compounds whose offset can be separated from driver pace.

    A compound's offset is only identified if it is linked to the reference
    compound through drivers who ran both (directly or via other compounds).
    """
    used = d.groupby("driver")["compound"].agg(set)
    linked, frontier = {reference}, [reference]
    while frontier:
        c = frontier.pop()
        for comps in used:
            if c in comps:
                for other in comps - linked:
                    linked.add(other)
                    frontier.append(other)
    return linked


def _fit_once(d: pd.DataFrame, compounds: list[str], reference: str,
              quadratic: set[str]) -> DegModel:
    drivers = sorted(d["driver"].unique())
    n = len(d)
    age = d["age"].to_numpy(float)
    lap = d["lap"].to_numpy(float)
    y = d["time"].to_numpy(float)
    comp = d["compound"].to_numpy()
    drv = d["driver"].to_numpy()

    cols: list[np.ndarray] = []
    names: list[tuple[str, str]] = []
    for dr in drivers:
        cols.append((drv == dr).astype(float))
        names.append(("mu", dr))
    for c in compounds:
        mask = (comp == c).astype(float)
        if c != reference:
            cols.append(mask)
            names.append(("offset", c))
        cols.append(mask * age)
        names.append(("lin", c))
        if c in quadratic:
            cols.append(mask * age * age)
            names.append(("quad", c))
    cols.append(lap)
    names.append(("lap", ""))

    X = np.column_stack(cols)
    beta, w = _irls(X, y)
    r = y - X @ beta
    # Robust residual scale (MAD). The weighted sum of squares would be inflated
    # by exactly the traffic laps the Huber weights are there to discount.
    sigma2 = float((1.4826 * np.median(np.abs(r - np.median(r)))) ** 2)
    XtWX = (X * w[:, None]).T @ X
    cov = sigma2 * np.linalg.pinv(XtWX)
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    ybar = np.sum(w * y) / np.sum(w)
    r2 = 1 - np.sum(w * r * r) / np.sum(w * (y - ybar) ** 2)

    idx = {name: i for i, name in enumerate(names)}
    fits: dict[str, CompoundFit] = {}
    for c in compounds:
        sel = comp == c
        o = idx.get(("offset", c))
        q = idx.get(("quad", c))
        fits[c] = CompoundFit(
            offset=float(beta[o]) if o is not None else 0.0,
            offset_se=float(se[o]) if o is not None else 0.0,
            lin=float(beta[idx[("lin", c)]]),
            lin_se=float(se[idx[("lin", c)]]),
            quad=float(beta[q]) if q is not None else 0.0,
            quad_se=float(se[q]) if q is not None else 0.0,
            quadratic=q is not None,
            laps=int(sel.sum()),
            age_min=int(age[sel].min()),
            age_max=int(age[sel].max()),
        )

    lap_coef = float(beta[idx[("lap", "")]])
    mu = {dr: float(beta[idx[("mu", dr)]]) for dr in drivers}
    mu_se = {dr: float(se[idx[("mu", dr)]]) for dr in drivers}

    # Points for the scatter: lap time with driver and fuel/track effects removed,
    # leaving compound offset + wear + residual.
    adj = y - np.array([mu[x] for x in drv]) - lap_coef * lap
    points = [
        {"driver": dv, "lap": int(lp), "compound": c, "age": int(a),
         "value": round(float(v), 3), "weight": round(float(wt), 2)}
        for dv, lp, c, a, v, wt in zip(drv, lap, comp, age, adj, w, strict=True)
    ]

    return DegModel(
        reference=reference,
        compounds=fits,
        lap_coef=lap_coef,
        lap_se=float(se[idx[("lap", "")]]),
        driver_mu=mu,
        driver_se=mu_se,
        sigma=float(np.sqrt(sigma2)),
        rmse=float(np.sqrt(np.mean(r * r))),
        r2=float(r2),
        n=n,
        downweighted=int((w < 0.5).sum()),  # residual beyond ~2.7 sigma
        points=points,
    )
