import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchRaceState,
  fetchOptimalStrategy,
  fetchTireDegradation,
  fetchTracks,
} from "./api";
import type { RaceState, OptimalStrategy, TireDegradationCurve, TrackInfo, Compound } from "./types";
import { TireDegradationChart } from "./components/TireDegradationChart";
import { GapChart } from "./components/GapChart";
import { StrategyViz } from "./components/StrategyViz";
import { TimingTower } from "./components/TimingTower";
import "./App.css";

const COMPOUNDS: Compound[] = ["SOFT", "MEDIUM", "HARD"];
const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#E8002D",
  MEDIUM: "#FFF200",
  HARD: "#C8C8C8",
};

type Tab = "timing" | "gaps" | "tyres" | "strategy";
type DegMode = "grip" | "penalty";

export default function App() {
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTrack, setSelectedTrack] = useState("Bahrain");
  const [currentLap, setCurrentLap] = useState(18);
  const [totalLaps, setTotalLaps] = useState(57);
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const [strategy, setStrategy] = useState<OptimalStrategy | null>(null);
  const [degCurves, setDegCurves] = useState<TireDegradationCurve[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("timing");
  const [degMode, setDegMode] = useState<DegMode>("grip");
  const [loading, setLoading] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const simRef = useRef<number | null>(null);

  const loadData = useCallback(async (track: string, lap: number) => {
    setLoading(true);
    setError(null);
    try {
      const [state, strat, ...curves] = await Promise.all([
        fetchRaceState(track, lap),
        fetchOptimalStrategy(track, ["MEDIUM", "HARD"]),
        ...COMPOUNDS.map((c) => fetchTireDegradation(c, track)),
      ]);
      setRaceState(state);
      setTotalLaps(state.total_laps);
      setStrategy(strat);
      setDegCurves(curves as TireDegradationCurve[]);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTracks().then(setTracks).catch(() => {});
  }, []);

  useEffect(() => {
    loadData(selectedTrack, currentLap);
  }, [selectedTrack, currentLap, loadData]);

  useEffect(() => {
    if (simRunning) {
      simRef.current = window.setInterval(() => {
        setCurrentLap((l) => {
          if (l >= totalLaps) { setSimRunning(false); return l; }
          return l + 1;
        });
      }, 2000);
    } else {
      if (simRef.current) clearInterval(simRef.current);
    }
    return () => { if (simRef.current) clearInterval(simRef.current); };
  }, [simRunning, totalLaps]);

  const pctComplete = totalLaps > 0 ? (currentLap / totalLaps) * 100 : 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: "timing", label: "Timing Tower" },
    { id: "gaps", label: "Gap Chart" },
    { id: "tyres", label: "Tyre Model" },
    { id: "strategy", label: "Pit Strategy" },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo"><span className="logo-dot" />PIT WALL</div>
          <select
            className="track-select"
            value={selectedTrack}
            onChange={(e) => { setSelectedTrack(e.target.value); setCurrentLap(1); setSimRunning(false); }}
          >
            {tracks.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            {!tracks.length && <option value="Bahrain">Bahrain</option>}
          </select>
        </div>

        <div className="header-center">
          <div className="lap-display">
            LAP <span className="lap-num">{currentLap}</span>
            <span className="lap-total"> / {totalLaps}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pctComplete}%` }} />
          </div>
        </div>

        <div className="header-right">
          {raceState && (
            <div className="temp-badge">{raceState.track_temp}°C <span className="temp-label">TRACK</span></div>
          )}
          <button
            className={`sim-btn ${simRunning ? "active" : ""}`}
            onClick={() => setSimRunning((r) => !r)}
            disabled={currentLap >= totalLaps}
          >
            {simRunning ? "⏸ PAUSE" : "▶ SIM"}
          </button>
          <input
            type="range" min={1} max={totalLaps} value={currentLap} step={1}
            onChange={(e) => { setSimRunning(false); setCurrentLap(Number(e.target.value)); }}
            style={{ width: 120 }}
          />
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>Backend unreachable:</strong> {error}
          <span className="error-hint"> — Run <code>uvicorn main:app --reload</code> in <code>/backend</code></span>
        </div>
      )}

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {loading && <div className="loading-overlay"><div className="spinner" /></div>}

        {activeTab === "timing" && raceState && (
          <div className="panel">
            <div className="panel-header">
              <h2>Live timing</h2>
              <span className="panel-sub">Lap {currentLap} of {totalLaps}</span>
            </div>
            <TimingTower drivers={raceState.drivers} />
            {raceState.drivers.some((d) => d.undercut_threat) && (
              <div className="alert-section">
                <div className="alert-header">⚡ STRATEGY ALERTS</div>
                {raceState.drivers.filter((d) => d.undercut_threat).map((d) => (
                  <div key={d.driver} className="alert-card">
                    <strong>{d.driver}</strong> undercut window in{" "}
                    <strong>{d.undercut_threat!.laps_until_window}</strong> laps —{" "}
                    estimated <strong>+{d.undercut_threat!.estimated_benefit_s}s</strong> benefit
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "gaps" && raceState && (
          <div className="panel">
            <div className="panel-header">
              <h2>Gap to leader</h2>
              <span className="panel-sub">Cumulative time delta</span>
            </div>
            <GapChart drivers={raceState.drivers} currentLap={currentLap} />
            <div className="panel-header" style={{ marginTop: 28 }}>
              <h2>True race pace model</h2>
              <span className="panel-sub">Regression on green-flag laps only</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  {["Driver", "True Pace", "Deg/lap", "R²", "Clean Laps"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {raceState.drivers.map((d) => {
                  const pm = d.pace_model;
                  const t = pm?.true_pace;
                  const timeStr = t ? `${Math.floor(t/60)}:${(t%60).toFixed(3).padStart(6,"0")}` : "—";
                  return (
                    <tr key={d.driver}>
                      <td style={{ color: "#fff", fontWeight: 600 }}>{d.driver}</td>
                      <td style={{ fontFamily: "monospace" }}>{timeStr}</td>
                      <td style={{ color: pm?.degradation_per_lap > 0 ? "#ff6b35" : "#4caf50" }}>
                        {pm?.degradation_per_lap != null ? `${pm.degradation_per_lap > 0 ? "+" : ""}${pm.degradation_per_lap.toFixed(3)}s` : "—"}
                      </td>
                      <td>{pm?.r_squared?.toFixed(3) ?? "—"}</td>
                      <td>{pm?.clean_lap_count ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "tyres" && (
          <div className="panel">
            <div className="panel-header">
              <h2>Tyre degradation model</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {(["grip", "penalty"] as DegMode[]).map((m) => (
                  <button key={m} className={`toggle-btn ${degMode === m ? "active" : ""}`} onClick={() => setDegMode(m)}>
                    {m === "grip" ? "Grip %" : "Time loss"}
                  </button>
                ))}
              </div>
            </div>
            <TireDegradationChart curves={degCurves} mode={degMode} />
            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              {degCurves.map((c) => (
                <div key={c.compound} className="compound-card">
                  <div className="compound-dot" style={{
                    backgroundColor: COMPOUND_COLORS[c.compound],
                    border: c.compound === "HARD" ? "1px solid #555" : "none",
                  }} />
                  <div>
                    <div className="compound-name">{c.compound}</div>
                    <div className="compound-detail">Thermal cliff — lap {c.cliff_lap}</div>
                    <div className="compound-detail">
                      {degMode === "grip"
                        ? `${c.grip_pct[c.cliff_lap]?.toFixed(1)}% grip at cliff`
                        : `+${c.time_penalty_s[c.cliff_lap]?.toFixed(2)}s at cliff`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "strategy" && (
          <div className="panel">
            <div className="panel-header">
              <h2>Optimal pit strategy</h2>
              <span className="panel-sub">DP graph optimization · {selectedTrack}</span>
            </div>
            {strategy ? <StrategyViz strategy={strategy} /> : <div className="muted-msg">Computing strategy…</div>}

            <div style={{ marginTop: 28 }}>
              <div className="panel-header">
                <h2>Try alternative strategies</h2>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {[["MEDIUM","HARD"],["SOFT","MEDIUM"],["SOFT","HARD"],["MEDIUM","HARD","SOFT"]].map((combo) => (
                  <button key={combo.join("-")} className="combo-btn"
                    onClick={async () => {
                      setLoading(true);
                      try { setStrategy(await fetchOptimalStrategy(selectedTrack, combo as Compound[])); }
                      finally { setLoading(false); }
                    }}>
                    {combo.join(" → ")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
