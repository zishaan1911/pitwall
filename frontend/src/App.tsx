import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { DATA_BASE, fetchCatalog, fetchSession } from "./api";
import { Methods } from "./components/Methods";
import { Scrubber } from "./components/Scrubber";
import { TimingTower } from "./components/TimingTower";
import { RaceContext, type RaceCtx, useRace } from "./context";
import { driverStyles } from "./lib/colors";
import { COMPOUND_SHORT, lapTime, signed } from "./lib/format";
import { fastestLap } from "./lib/race";
import type { Catalog, Kind, Session } from "./types";
import { ConditionsView } from "./views/ConditionsView";
import { RaceView } from "./views/RaceView";
import { StrategyView } from "./views/StrategyView";
import { TelemetryView } from "./views/TelemetryView";
import { TyresView } from "./views/TyresView";

const TABS = [
  { id: "race", label: "RACE", View: RaceView },
  { id: "tyres", label: "TYRES", View: TyresView },
  { id: "strategy", label: "STRATEGY", View: StrategyView },
  { id: "telemetry", label: "TELEMETRY", View: TelemetryView },
  { id: "conditions", label: "CONDITIONS", View: ConditionsView },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface Route {
  year: number;
  round: number;
  kind: Kind;
  tab: TabId;
}

function parseHash(): Partial<Route> {
  const m = /^#\/(\d{4})\/(\d{1,2})-([RS])(?:\/(\w+))?/.exec(window.location.hash);
  if (!m) return {};
  const tab = TABS.find((t) => t.id === m[4])?.id ?? "race";
  return { year: Number(m[1]), round: Number(m[2]), kind: m[3] as Kind, tab };
}

function writeHash(r: Route) {
  const h = `#/${r.year}/${String(r.round).padStart(2, "0")}-${r.kind}/${r.tab}`;
  if (window.location.hash !== h) window.history.replaceState(null, "", h);
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMethods, setShowMethods] = useState(false);

  useEffect(() => {
    fetchCatalog()
      .then((c) => {
        setCatalog(c);
        const h = parseHash();
        const latest = pickLatest(c);
        if (h.year && h.round && h.kind) setRoute({ year: h.year, round: h.round, kind: h.kind, tab: h.tab ?? "race" });
        else if (latest) setRoute({ ...latest, tab: "race" });
      })
      .catch((e: Error) => setError(`Could not load the session index (${e.message}).`));
    const onHash = () => {
      const h = parseHash();
      if (h.year && h.round && h.kind) setRoute({ year: h.year, round: h.round, kind: h.kind, tab: h.tab ?? "race" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!route) return;
    writeHash(route);
  }, [route]);

  const key = route ? `${route.year}/${route.round}/${route.kind}` : null;
  useEffect(() => {
    if (!route) return;
    let live = true;
    setLoading(true);
    setError(null);
    fetchSession(route.year, route.round, route.kind)
      .then((s) => {
        if (!live) return;
        setSession(s);
        document.title = `${s.meta.year} ${s.meta.event} ${s.meta.session} · pitwall`;
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="app">
      <TopBar
        catalog={catalog}
        route={route}
        session={session}
        onRoute={(r) => setRoute((cur) => (cur ? { ...cur, ...r } : cur))}
        onMethods={() => setShowMethods(true)}
      />
      {error && !loading && (
        <div className="loading">
          <div>
            <div className="error">SESSION UNAVAILABLE</div>
            <div className="dim">{error}</div>
          </div>
        </div>
      )}
      {loading && (
        <div className="loading">
          <div>
            LOADING SESSION
            <div className="spinner" />
            <div className="dim" style={{ fontSize: 10 }}>
              {DATA_BASE.startsWith("/api")
                ? "first request pulls timing, telemetry, weather and radio from the archives (~1 min)"
                : "reading prebuilt bundle"}
            </div>
          </div>
        </div>
      )}
      {session && route && !loading && !error && (
        <Dashboard
          key={key}
          session={session}
          tab={route.tab}
          onTab={(tab) => setRoute({ ...route, tab })}
        />
      )}
      <footer className="footer">
        <span>pitwall v{session?.meta.pitwall ?? "2"}</span>
        <span>
          data: <a href="https://github.com/theOehrly/Fast-F1">FastF1</a> (F1 live timing archive) ·{" "}
          <a href="https://openf1.org">OpenF1</a> · <a href="https://github.com/jolpica/jolpica-f1">Jolpica</a> ·{" "}
          <a href="https://open-meteo.com">Open-Meteo</a>
        </span>
        {session && <span>bundle built {session.meta.generated_at.replace("T", " ").slice(0, 16)} UTC</span>}
        <span>Unofficial. Not associated with Formula 1 companies.</span>
        <span style={{ marginLeft: "auto" }}>
          <a href="https://github.com/zishaan1911/pitwall">source</a>
        </span>
      </footer>
      {showMethods && <Methods onClose={() => setShowMethods(false)} />}
    </div>
  );
}

function pickLatest(c: Catalog): Omit<Route, "tab"> | null {
  for (const season of c.seasons) {
    for (const ev of [...season.events].reverse()) {
      const kinds = c.mode === "static" ? ev.built : ev.sessions;
      if (kinds.includes("R")) return { year: season.year, round: ev.round, kind: "R" };
      if (kinds.length) return { year: season.year, round: ev.round, kind: kinds[0] };
    }
  }
  return null;
}

function TopBar({
  catalog,
  route,
  session,
  onRoute,
  onMethods,
}: {
  catalog: Catalog | null;
  route: Route | null;
  session: Session | null;
  onRoute: (r: Partial<Route>) => void;
  onMethods: () => void;
}) {
  const season = catalog?.seasons.find((s) => s.year === route?.year);
  const event = season?.events.find((e) => e.round === route?.round);
  const avail = (kinds: Kind[], built: Kind[]) => (catalog?.mode === "static" ? built : kinds);

  return (
    <div className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
          <rect x="1" y="1" width="20" height="20" fill="none" stroke="#ffb400" strokeWidth="1.5" />
          <path d="M5 16 L9 8 L12 13 L14 10 L17 16" fill="none" stroke="#ffb400" strokeWidth="1.5" />
        </svg>
        PITWALL <small>RACE ENGINEERING</small>
      </div>
      {catalog && (
        <div className="picker">
          <select
            className="select"
            value={route?.year ?? ""}
            onChange={(e) => {
              const y = Number(e.target.value);
              const s = catalog.seasons.find((x) => x.year === y);
              const ev = s?.events.filter((ev) => avail(ev.sessions, ev.built).length).at(-1);
              if (ev) onRoute({ year: y, round: ev.round, kind: avail(ev.sessions, ev.built).includes("R") ? "R" : avail(ev.sessions, ev.built)[0] });
            }}
            aria-label="Season"
          >
            {catalog.seasons.map((s) => (
              <option key={s.year} value={s.year}>
                {s.year}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={route?.round ?? ""}
            onChange={(e) => {
              const r = Number(e.target.value);
              const ev = season?.events.find((x) => x.round === r);
              const kinds = ev ? avail(ev.sessions, ev.built) : [];
              onRoute({ round: r, kind: kinds.includes(route?.kind ?? "R") ? route!.kind : kinds.includes("R") ? "R" : kinds[0] });
            }}
            aria-label="Grand Prix"
          >
            {season?.events.map((ev) => (
              <option key={ev.round} value={ev.round} disabled={!avail(ev.sessions, ev.built).length}>
                R{String(ev.round).padStart(2, "0")} · {ev.name.replace("Grand Prix", "GP")}
              </option>
            ))}
          </select>
          {event && (
            <div className="seg" role="group" aria-label="Session">
              {(["R", "S"] as Kind[])
                .filter((k) => event.sessions.includes(k))
                .map((k) => (
                  <button
                    key={k}
                    aria-pressed={route?.kind === k}
                    disabled={!avail(event.sessions, event.built).includes(k)}
                    onClick={() => onRoute({ kind: k })}
                  >
                    {k === "R" ? "RACE" : "SPRINT"}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      <button className="btn" onClick={onMethods}>
        METHODS
      </button>
      {session && (
        <div className="sources" title="Upstream data sources for this bundle">
          {Object.entries({
            FASTF1: session.meta.sources.fastf1,
            OPENF1: session.meta.sources.openf1,
            JOLPICA: session.meta.sources.jolpica,
            "OPEN-METEO": session.meta.sources.open_meteo,
          }).map(([k, v]) => (
            <span key={k} title={v?.error ?? "ok"}>
              <span className={`dot ${v?.ok ? "" : "off"}`} />
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({ session, tab, onTab }: { session: Session; tab: TabId; onTab: (t: TabId) => void }) {
  const total = session.leader_ends.length;
  const [lap, setLapState] = useState(total);
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const setLap = useCallback((l: number) => setLapState(Math.min(Math.max(1, Math.round(l)), total)), [total]);
  const toggleFocus = useCallback(
    (code: string) =>
      setFocus((f) => {
        const n = new Set(f);
        if (n.has(code)) n.delete(code);
        else n.add(code);
        return n;
      }),
    [],
  );
  const styles = useMemo(() => driverStyles(session.drivers), [session]);
  const ctx: RaceCtx = { session, lap, setLap, focus, toggleFocus, styles };
  const View = TABS.find((t) => t.id === tab)!.View;

  return (
    <RaceContext.Provider value={ctx}>
      <Headline />
      <Scrubber />
      <div className="body">
        <TimingTower />
        <main className="main">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === tab} onClick={() => onTab(t.id)}>
                {t.label}
              </button>
            ))}
            {focus.size > 0 && (
              <button className="hint" onClick={() => setFocus(new Set())} style={{ border: 0, background: "none", cursor: "pointer" }}>
                highlighting {[...focus].join(", ")} · clear ✕
              </button>
            )}
          </nav>
          <View />
        </main>
      </div>
    </RaceContext.Provider>
  );
}

function Headline() {
  const { session, styles } = useRace();
  const m = session.meta;
  const byPos = [...session.drivers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const winner = byPos[0];
  const second = byPos[1];
  const endOf = (code?: string) => {
    const L = code ? session.laps[code] : undefined;
    return L ? L.end[L.end.length - 1] : null;
  };
  const margin =
    winner && second && session.laps[second.code]?.lap.length === session.laps[winner.code]?.lap.length
      ? (endOf(second.code) ?? 0) - (endOf(winner.code) ?? 0)
      : null;
  const fl = fastestLap(session);
  const best = session.strategy?.ranked[0];
  const neutral = session.track_status.filter((p) => p.kind !== "YELLOW");
  const count = (k: string) => neutral.filter((p) => p.kind === k).length;
  const neutralText = neutral.length
    ? [["SC", count("SC")], ["VSC", count("VSC")], ["RED", count("RED")]]
        .filter(([, n]) => n)
        .map(([k, n]) => `${n}× ${k}`)
        .join(" · ")
    : "none";

  return (
    <div className="headline">
      <div>
        <div className="event-name">
          {m.year} {m.event}
          {m.kind === "S" && <span className="accent"> · SPRINT</span>}
        </div>
        <div className="event-sub">
          ROUND {m.round} · {m.circuit?.name ?? m.location}, {m.country} · {m.date} · {m.total_laps} LAPS
          {m.scheduled_laps > m.total_laps && <span className="accent"> OF {m.scheduled_laps} (SHORTENED)</span>}
          {session.track ? ` · ${(session.track.length / 1000).toFixed(3)} KM` : ""}
          {m.wet && <span className="accent"> · WET</span>}
        </div>
      </div>
      <div className="kpis">
        <Kpi k="Winner" v={<span style={{ color: winner ? styles[winner.code]?.color : undefined }}>{winner?.code ?? "—"}</span>} s={margin != null ? `by ${margin.toFixed(3)}s over ${second?.code}` : winner?.team} />
        <Kpi k="Fastest lap" v={lapTime(fl?.time)} s={fl ? `${fl.code} · lap ${fl.lap}` : ""} />
        <Kpi
          k="Model optimum"
          v={best ? best.stints.map((s) => COMPOUND_SHORT[s.compound]).join("–") : "n/a"}
          s={best ? `${best.stops}-stop · ${best.stints.map((s) => s.laps).join("/")} laps` : m.wet ? "wet race" : m.kind === "S" ? "sprint: no stop rule" : "insufficient data"}
        />
        <Kpi k="Pit loss (green)" v={session.pit_loss.GREEN ? `${session.pit_loss.GREEN.median.toFixed(1)}s` : "—"} s={session.pit_loss.SC ? `SC stop ${session.pit_loss.SC.median.toFixed(1)}s` : `n=${session.pit_loss.GREEN?.n ?? 0}`} />
        <Kpi k="Fuel + track" v={session.model ? `${signed(session.model.lap_coef, 3)}s` : "—"} s="per lap, fitted" />
        <Kpi k="Neutralised" v={neutralText} s={`${session.race_control.length} RC messages`} />
      </div>
    </div>
  );
}

function Kpi({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}
