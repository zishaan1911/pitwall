import { useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { UPlot } from "../components/UPlot";
import { Empty, Panel, Seg, Tyre } from "../components/ui";
import { useRace } from "../context";
import { axis, baseCursor, fade, lapMarker, statusBands } from "../lib/chart";
import { clock, lapTime, signed } from "../lib/format";
import { gapSeries, historySeries, positionSeries } from "../lib/race";
import { tooltip } from "../lib/tooltip";

type Mode = "history" | "gap" | "position";

const MODES: { value: Mode; label: string }[] = [
  { value: "history", label: "RACE HISTORY" },
  { value: "gap", label: "GAP TO LEADER" },
  { value: "position", label: "LAP CHART" },
];

export function RaceView() {
  return (
    <div className="view">
      <RaceChart />
      <RaceControl />
      <TeamRadio />
      <Classification />
    </div>
  );
}

function RaceChart() {
  const { session, lap, focus, styles } = useRace();
  const [mode, setMode] = useState<Mode>("history");
  const lapRef = useRef(lap);
  lapRef.current = lap;
  const plot = useRef<uPlot | null>(null);

  const codes = useMemo(
    () =>
      [...session.drivers]
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
        .map((d) => d.code)
        .filter((c) => session.laps[c]),
    [session],
  );

  const series = useMemo(() => {
    if (mode === "gap") return gapSeries(session);
    if (mode === "position") return positionSeries(session);
    return historySeries(session);
  }, [session, mode]);

  const data = useMemo<uPlot.AlignedData>(() => {
    const laps = session.leader_ends.map((_, i) => i + 1);
    return [laps, ...codes.map((c) => series[c] as (number | null)[])] as uPlot.AlignedData;
  }, [session, codes, series]);

  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(() => {
    const anyFocus = focus.size > 0;
    const fmt =
      mode === "position" ? (v: number) => `P${v}` : (v: number) => signed(v, 1, "s");
    return {
      legend: { show: false },
      cursor: { ...baseCursor(), focus: { prox: 16 } },
      focus: { alpha: 0.25 },
      scales: {
        x: { time: false },
        y:
          mode === "position"
            ? { dir: -1, range: [0.5, codes.length + 0.5] }
            : mode === "gap"
              ? { dir: -1, range: (_u, min, max) => [Math.min(0, min) - 1, Math.min(max, 120) + 1] }
              : {},
      },
      axes: [
        axis({ label: "LAP", labelSize: 14, size: 34 }),
        axis({
          size: 50,
          values: (_u, ticks) => ticks.map((t) => (mode === "position" ? `P${t}` : `${t}s`)),
          ...(mode === "position" ? { incrs: [1, 2, 5] } : {}),
        }),
      ],
      series: [
        { label: "Lap" },
        ...codes.map((c) => {
          const st = styles[c];
          const on = !anyFocus || focus.has(c);
          return {
            label: c,
            stroke: on ? st.color : fade(st.color, 0.14),
            width: anyFocus && on ? 2.2 : 1.3,
            dash: st.dash,
            spanGaps: false,
            points: { show: false },
          } satisfies uPlot.Series;
        }),
      ],
      plugins: [
        statusBands(session.track_status),
        lapMarker(() => lapRef.current),
        tooltip({
          title: (_u, i) => `LAP ${i + 1}`,
          value: fmt,
          sortAsc: mode !== "history",
        }),
      ],
    };
  }, [codes, styles, focus, mode, session]);

  useEffect(() => {
    plot.current?.redraw(false);
  }, [lap]);

  const subs: Record<Mode, string> = {
    history:
      "laps × winner's average lap − elapsed time · flat = winner pace, falling = losing time, steps = pit stops",
    gap: "seconds behind the leader at each lap line",
    position: "running order at each lap line",
  };

  return (
    <Panel
      title="Race trace"
      sub={subs[mode]}
      actions={<Seg value={mode} options={MODES} onChange={setMode} />}
      note="Drag to zoom, double-click to reset. Shaded: SC / VSC / red flag. The amber dashed line follows the lap scrubber."
    >
      <UPlot options={options} data={data} height={380} onCreate={(u) => (plot.current = u)} />
      <div className="legend" style={{ marginTop: 8 }}>
        {codes.map((c) => (
          <span key={c}>
            <i style={{ background: styles[c].color, opacity: styles[c].second ? 0.6 : 1 }} />
            {c}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function RaceControl() {
  const { session, lap, setLap } = useRace();
  const [filter, setFilter] = useState<"key" | "all">("key");
  const lapEnd = session.leader_ends[lap - 1] ?? Infinity;
  const msgs = session.race_control.filter((m) => {
    if (filter === "all") return true;
    const text = m.message.toUpperCase();
    return (
      m.category === "SafetyCar" ||
      m.flag === "RED" ||
      m.flag === "CHEQUERED" ||
      /PENALTY|INVESTIGATION|DRS|SAFETY CAR|VSC|INCIDENT|RETIRED|STOPPED|NOTED/.test(text)
    );
  });

  return (
    <Panel
      title="Race control"
      span={7}
      sub={`${msgs.length} messages · click a row to jump to that lap`}
      actions={
        <Seg
          value={filter}
          options={[
            { value: "key", label: "KEY" },
            { value: "all", label: "ALL" },
          ]}
          onChange={setFilter}
        />
      }
      flush
    >
      {msgs.length === 0 ? (
        <Empty>No messages</Empty>
      ) : (
        <div className="feed">
          {msgs.map((m, i) => {
            const cls = [
              "feed-row",
              m.t > lapEnd ? "future" : "",
              m.flag ? `flag-${m.flag.replace(/\s/g, "")}` : "",
              /PENALTY/.test(m.message) ? "cat-penalty" : "",
              m.category === "SafetyCar" ? "cat-sc" : "",
            ].join(" ");
            return (
              <div key={i} className={cls} onClick={() => m.lap && setLap(Math.min(m.lap, session.leader_ends.length))} style={{ cursor: m.lap ? "pointer" : "default" }}>
                <span className="lap">{m.lap ? `L${m.lap}` : "PRE"}</span>
                <span>
                  <span className="cat">{clock(m.t, session.meta.start_s)} · {m.category.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()}</span>
                  <span className="msg">{m.message}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function TeamRadio() {
  const { session, lap, styles } = useRace();
  const radio = session.radio;
  return (
    <Panel title="Team radio" span={5} sub={`${radio.length} clips · OpenF1 / F1 live timing`} flush>
      {radio.length === 0 ? (
        <Empty>No radio archive for this session</Empty>
      ) : (
        <div className="feed">
          {radio.map((r, i) => (
            <div key={i} className={`feed-row ${r.lap > lap ? "future" : ""}`}>
              <span className="lap">{r.lap ? `L${r.lap}` : "PRE"}</span>
              <span>
                <RadioClip url={r.url} />
                <b style={{ color: r.driver ? styles[r.driver]?.color : undefined }}>{r.driver ?? "—"}</b>
                <span className="dim"> · {clock(r.t, session.meta.start_s)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// One clip plays at a time across the feed.
let playing: HTMLAudioElement | null = null;

function RadioClip({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "playing" | "error">("idle");
  const [progress, setProgress] = useState(0);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    if (!audio.current) {
      const a = new Audio(url);
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => {
        setState("idle");
        setProgress(0);
      };
      a.onpause = () => setState((s) => (s === "playing" ? "idle" : s));
      a.onerror = () => setState("error");
      audio.current = a;
    }
    const a = audio.current;
    if (state === "playing") {
      a.pause();
      return;
    }
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.play().then(() => setState("playing")).catch(() => setState("error"));
  };

  return (
    <button
      className={`radio-btn ${state}`}
      onClick={toggle}
      disabled={state === "error"}
      aria-label={state === "playing" ? "Pause radio clip" : "Play radio clip"}
      title={state === "error" ? "Clip unavailable" : undefined}
    >
      <span>{state === "playing" ? "❚❚" : state === "error" ? "✕" : "▶"}</span>
      <i style={{ width: `${progress * 100}%` }} />
    </button>
  );
}

function Classification() {
  const { session, styles, toggleFocus } = useRace();
  const bestByDriver = useMemo(() => {
    const out: Record<string, { time: number; lap: number } | undefined> = {};
    for (const [code, L] of Object.entries(session.laps)) {
      L.time.forEach((t, i) => {
        if (t == null || L.pit_in[i] || L.pit_out[i]) return;
        if (!out[code] || t < out[code]!.time) out[code] = { time: t, lap: L.lap[i] };
      });
    }
    return out;
  }, [session]);
  const fastest = Math.min(...Object.values(bestByDriver).map((b) => b?.time ?? Infinity));
  const stopCount = (code: string) => session.pit_stops.filter((s) => s.driver === code && s.new_set).length;
  const trap = (code: string) => {
    const v = session.laps[code]?.trap.filter((x): x is number => x != null) ?? [];
    return v.length ? Math.max(...v) : null;
  };
  const pace = new Map(session.model?.driver_pace.map((p) => [p.driver, p]) ?? []);

  return (
    <Panel title="Classification" sub="official result + derived metrics" flush>
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>POS</th>
              <th>DRIVER</th>
              <th>TEAM</th>
              <th className="r">GRID</th>
              <th className="r">+/−</th>
              <th>STATUS</th>
              <th className="r">PTS</th>
              <th className="r">STOPS</th>
              <th>STINTS</th>
              <th className="r">BEST LAP</th>
              <th className="r" title="Fuel- and tyre-corrected pace from the degradation model">MODEL PACE</th>
              <th className="r" title="Highest speed-trap reading">TRAP</th>
              <th className="r" title="On-track position exchanges from OpenF1 (made / lost)">PASSES</th>
            </tr>
          </thead>
          <tbody>
            {[...session.drivers]
              .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
              .map((d) => {
                const best = bestByDriver[d.code];
                const change = d.grid && d.position ? d.grid - d.position : null;
                const p = pace.get(d.code);
                const passes = session.passes[d.code];
                return (
                  <tr key={d.code} onClick={() => toggleFocus(d.code)} style={{ cursor: "pointer" }}>
                    <td>{d.classified || d.position}</td>
                    <td>
                      <span className="teambar" style={{ background: styles[d.code]?.color, display: "inline-block", width: 3, height: 12, marginRight: 6, verticalAlign: -2 }} />
                      <b>{d.code}</b> <span className="muted">{d.name}</span>
                    </td>
                    <td className="muted">{d.team}</td>
                    <td className="r">{d.grid ?? "PL"}</td>
                    <td className={`r ${change && change > 0 ? "up" : change && change < 0 ? "down" : "dim"}`}>
                      {change ? signed(change, 0) : "·"}
                    </td>
                    <td className={/Finished|Lap/.test(d.status) ? "muted" : "down"}>{d.status}</td>
                    <td className="r">{d.points ?? ""}</td>
                    <td className="r">{stopCount(d.code)}</td>
                    <td>
                      {session.stints
                        .filter((s) => s.driver === d.code)
                        .map((s) => (
                          <span key={s.stint} style={{ marginRight: 4 }}>
                            <Tyre compound={s.compound} age={s.laps} />
                          </span>
                        ))}
                    </td>
                    <td className={`r ${best && best.time === fastest ? "ob" : ""}`}>
                      {lapTime(best?.time)} <span className="dim">L{best?.lap ?? "–"}</span>
                    </td>
                    <td className="r">{p ? (p.delta === 0 ? <span className="accent">REF</span> : signed(p.delta, 3)) : <span className="dim">—</span>}</td>
                    <td className="r">{trap(d.code) ?? "—"}</td>
                    <td className="r">{passes ? `${passes.made} / ${passes.lost}` : "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
