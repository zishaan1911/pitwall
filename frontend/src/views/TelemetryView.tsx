import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { fetchTelemetry } from "../api";
import { UPlot } from "../components/UPlot";
import { Empty, Panel, Stat, Tyre } from "../components/ui";
import { useRace } from "../context";
import { ACCENT, axis, FONT, INK } from "../lib/chart";
import { lapTime, num, signed } from "../lib/format";
import { interp } from "../lib/race";
import type { Corner, Telemetry, Track } from "../types";

const SYNC = "tel";
const MINISECTORS = 30;
const COLOR_B_FALLBACK = "#2ec5f5";

// Step renderer for discrete channels (gear, brake, DRS).
const stepPaths = uPlot.paths.stepped!({ align: 1 });

interface Pair {
  a: Telemetry;
  b: Telemetry;
  d: number[];
  bOn: Record<"speed" | "throttle" | "brake" | "gear" | "rpm" | "drs" | "t", number[]>;
  delta: number[];
}

function align(a: Telemetry, b: Telemetry): Pair {
  // Put B on A's distance grid, rescaled so both laps span the same length.
  const scale = a.d[a.d.length - 1] / b.d[b.d.length - 1];
  const bd = b.d.map((v) => v * scale);
  const on = (ch: number[]) => interp(bd, ch, a.d);
  const t = on(b.t);
  return {
    a,
    b,
    d: a.d,
    bOn: {
      speed: on(b.speed),
      throttle: on(b.throttle),
      brake: on(b.brake).map((v) => (v >= 0.5 ? 1 : 0)),
      gear: on(b.gear).map(Math.round),
      rpm: on(b.rpm),
      drs: on(b.drs).map((v) => (v >= 0.5 ? 1 : 0)),
      t,
    },
    delta: t.map((tb, i) => tb - a.t[i]),
  };
}

export function TelemetryView() {
  const { session, styles } = useRace();
  const available = session.telemetry.map((t) => t.driver);
  const order = [...session.drivers]
    .sort((x, y) => (x.position ?? 99) - (y.position ?? 99))
    .map((d) => d.code)
    .filter((c) => available.includes(c));
  const [codeA, setCodeA] = useState(order[0]);
  const [codeB, setCodeB] = useState(order[1] ?? order[0]);
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const { year, round, kind } = session.meta;

  useEffect(() => {
    if (!codeA || !codeB) return;
    let live = true;
    setError(null);
    Promise.all([fetchTelemetry(year, round, kind, codeA), fetchTelemetry(year, round, kind, codeB)])
      .then(([a, b]) => live && setPair(align(a, b)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [year, round, kind, codeA, codeB]);

  if (!available.length) {
    return (
      <div className="view">
        <Panel title="Telemetry">
          <Empty>No car telemetry in the archive for this session.</Empty>
        </Panel>
      </div>
    );
  }

  const colA = styles[codeA]?.color ?? ACCENT;
  let colB = styles[codeB]?.color ?? COLOR_B_FALLBACK;
  if (colB === colA) colB = COLOR_B_FALLBACK; // teammates share a livery colour

  const picker = (value: string, onChange: (v: string) => void, color: string, label: string) => (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ color, fontWeight: 700 }}
      aria-label={label}
    >
      {order.map((c) => (
        <option key={c} value={c}>
          {c} · {lapTime(session.telemetry.find((t) => t.driver === c)?.lap_time)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="view">
      <Panel
        title="Fastest-lap telemetry"
        sub="car data ~4 Hz merged with position data, aligned on distance"
        actions={
          <>
            {picker(codeA, setCodeA, colA, "First driver")}
            <span className="dim">vs</span>
            {picker(codeB, setCodeB, colB, "Second driver")}
          </>
        }
        note="Hover any trace to move the marker on the map. Drag to zoom into a corner; double-click to reset. Δ above zero means the second driver is behind at that point of the lap."
      >
        {error && <div className="error">{error}</div>}
        {!pair ? (
          <div className="loading" style={{ minHeight: 200 }}>
            LOADING TELEMETRY
            <div className="spinner" />
          </div>
        ) : (
          <>
            <Readout pair={pair} idx={cursor} colA={colA} colB={colB} />
            <Traces pair={pair} colA={colA} colB={colB} corners={session.track?.corners ?? []} onCursor={setCursor} />
          </>
        )}
      </Panel>
      {pair && (
        <>
          <TrackMap pair={pair} track={session.track} colA={colA} colB={colB} cursor={cursor} />
          <LapSummary pair={pair} colA={colA} colB={colB} />
          <CornerTable pair={pair} corners={session.track?.corners ?? []} colA={colA} colB={colB} />
          {session.track && <Elevation track={session.track} cursorD={cursor != null ? pair.d[cursor] : null} />}
        </>
      )}
    </div>
  );
}

function Readout({ pair, idx, colA, colB }: { pair: Pair; idx: number | null; colA: string; colB: string }) {
  const i = Math.min(idx ?? 0, pair.d.length - 1);
  const { a, bOn } = pair;
  const cell = (label: string, va: string, vb?: string) => (
    <div className="stat" style={{ padding: "5px 8px" }}>
      <div className="k">{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap" }}>
        <span style={{ color: colA }}>{va}</span>
        {vb != null && <span className="dim"> / </span>}
        {vb != null && <span style={{ color: colB }}>{vb}</span>}
      </div>
    </div>
  );
  return (
    <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", marginBottom: 8 }}>
      {cell("Distance", `${pair.d[i].toFixed(0)} m`)}
      {cell("Speed", `${a.speed[i]}`, `${Math.round(bOn.speed[i])}`)}
      {cell("Δ time", signed(pair.delta[i], 3))}
      {cell("Throttle", `${a.throttle[i]}%`, `${Math.round(bOn.throttle[i])}%`)}
      {cell("Brake", a.brake[i] ? "ON" : "—", bOn.brake[i] ? "ON" : "—")}
      {cell("Gear", `${a.gear[i]}`, `${bOn.gear[i]}`)}
      {cell("RPM", `${a.rpm[i]}`, `${Math.round(bOn.rpm[i] / 10) * 10}`)}
      {cell("DRS", a.drs[i] ? "OPEN" : "—", bOn.drs[i] ? "OPEN" : "—")}
    </div>
  );
}

function cornerPlugin(corners: Corner[], labels: boolean): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const { ctx } = u;
        const { top, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = "rgba(125,138,151,0.14)";
        ctx.fillStyle = INK;
        ctx.font = FONT.replace("11px", `${9 * devicePixelRatio}px`);
        ctx.textAlign = "center";
        for (const c of corners) {
          const x = u.valToPos(c.distance, "x", true);
          if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
          if (labels) ctx.fillText(`T${c.number}${c.letter}`, x, top + 10 * devicePixelRatio);
        }
        ctx.restore();
      },
    },
  };
}

function Traces({
  pair,
  colA,
  colB,
  corners,
  onCursor,
}: {
  pair: Pair;
  colA: string;
  colB: string;
  corners: Corner[];
  onCursor: (i: number | null) => void;
}) {
  const raf = useRef(0);
  const report = useRef(onCursor);
  report.current = onCursor;
  const plots = useRef(new Set<uPlot>());

  const channels = useMemo(() => {
    const { a, bOn, d, delta } = pair;
    return [
      { key: "speed", label: "SPEED", h: 190, data: [d, a.speed, bOn.speed], step: false },
      { key: "delta", label: "Δ TIME", h: 110, data: [d, delta], step: false },
      { key: "throttle", label: "THROTTLE", h: 90, data: [d, a.throttle, bOn.throttle], step: false },
      { key: "brake", label: "BRAKE", h: 60, data: [d, a.brake, bOn.brake], step: true },
      { key: "gear", label: "GEAR", h: 90, data: [d, a.gear, bOn.gear], step: true },
      { key: "rpm", label: "RPM", h: 100, data: [d, a.rpm, bOn.rpm], step: false },
      { key: "drs", label: "DRS", h: 50, data: [d, a.drs, bOn.drs], step: true },
    ] as const;
  }, [pair]);

  const charts = useMemo(() => {
    return channels.map((ch, idx) => {
      const last = idx === channels.length - 1;
      const stepped = ch.step ? { paths: stepPaths } : {};
      const binary = ch.key === "brake" || ch.key === "drs";
      const series: uPlot.Series[] =
        ch.key === "delta"
          ? [{}, { label: `Δ ${pair.b.driver}−${pair.a.driver}`, stroke: colB, width: 1.6, fill: "rgba(46,197,245,0.06)" }]
          : [
              {},
              { label: pair.a.driver, stroke: colA, width: 1.5, ...stepped },
              { label: pair.b.driver, stroke: colB, width: 1.5, dash: [4, 3], ...stepped },
            ];
      const opts: Omit<uPlot.Options, "width" | "height"> = {
        legend: { show: false },
        cursor: {
          sync: { key: SYNC, setSeries: false },
          drag: { x: true, y: false, setScale: true },
          points: { size: 5 },
        },
        scales: {
          x: { time: false },
          y: binary
            ? { range: [-0.1, 1.2] }
            : ch.key === "throttle"
              ? { range: [-5, 105] }
              : ch.key === "gear"
                ? { range: [0, 9] }
                : {},
        },
        axes: [
          axis({ show: true, size: last ? 30 : 8, values: last ? (_u, t) => t.map((v) => `${v}m`) : () => [] }),
          axis({
            size: 56,
            label: ch.label,
            labelSize: 12,
            labelGap: 0,
            ...(binary
              ? { values: (_u, t) => t.map((v) => (v === 1 ? "ON" : v === 0 ? "OFF" : "")), splits: () => [0, 1] }
              : {}),
          }),
        ],
        series,
        plugins: [cornerPlugin(corners, ch.key === "speed")],
        hooks: {
          setCursor: [
            (u) => {
              if (idx !== 0) return;
              cancelAnimationFrame(raf.current);
              const i = u.cursor.idx;
              raf.current = requestAnimationFrame(() => report.current(i ?? null));
            },
          ],
          setScale: [
            (u, key) => {
              if (key !== "x") return;
              // keep every channel on the same zoom window
              const { min, max } = u.scales.x;
              for (const other of plots.current) {
                if (!other.root.isConnected) plots.current.delete(other);
                else if (other !== u && other.scales.x.min !== min) other.setScale("x", { min: min!, max: max! });
              }
            },
          ],
        },
      };
      return { opts, ch };
    });
  }, [channels, colA, colB, corners, pair]);

  return (
    <div>
      {charts.map(({ opts, ch }) => (
        <UPlot
          key={ch.key}
          options={opts}
          data={ch.data as unknown as uPlot.AlignedData}
          height={ch.h}
          onCreate={(u) => plots.current.add(u)}
        />
      ))}
    </div>
  );
}

function TrackMap({
  pair,
  track,
  colA,
  colB,
  cursor,
}: {
  pair: Pair;
  track: Track | null;
  colA: string;
  colB: string;
  cursor: number | null;
}) {
  const { a } = pair;
  const geo = useMemo(() => {
    const rot = ((track?.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const pts = a.x.map((x, i) => [x * cos - a.y[i] * sin, x * sin + a.y[i] * cos]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 900;
    return { pts, cos, sin, minX, maxY, pad, W: maxX - minX + pad * 2, H: maxY - minY + pad * 2 };
  }, [a, track]);
  const { pts, cos, sin, minX, maxY, pad, W, H } = geo;
  const sx = (x: number) => x - minX + pad;
  const sy = (y: number) => maxY - y + pad;

  // Mini-sectors: who covered each slice of the lap faster.
  const segs = useMemo(() => {
    const len = pair.d[pair.d.length - 1];
    const bounds = Array.from({ length: MINISECTORS + 1 }, (_, i) => (len * i) / MINISECTORS);
    const tA = interp(pair.d, a.t, bounds);
    const tB = interp(pair.d, pair.bOn.t, bounds);
    return bounds.slice(0, -1).map((_, k) => {
      const da = tA[k + 1] - tA[k];
      const db = tB[k + 1] - tB[k];
      const w = Math.abs(da - db) < 0.005 ? "tie" : da < db ? "a" : "b";
      let path = "";
      pair.d.forEach((d, i) => {
        if (d >= bounds[k] && d <= bounds[k + 1] + 20) {
          path += `${path ? "L" : "M"}${(pts[i][0] - minX + pad).toFixed(0)},${(maxY - pts[i][1] + pad).toFixed(0)}`;
        }
      });
      return { w, path };
    });
  }, [pair, a, pts, minX, maxY, pad]);
  const aWins = segs.filter((s) => s.w === "a").length;
  const bWins = segs.filter((s) => s.w === "b").length;
  const stroke = Math.max(W, H) / 110;

  return (
    <Panel
      title="Track dominance"
      span={5}
      sub={`${MINISECTORS} mini-sectors · ${a.driver} ${aWins} – ${bWins} ${pair.b.driver}`}
      note="Each slice is coloured by the driver who covered it faster (grey = within 5 ms). Corner numbers from the F1 circuit data."
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxHeight: 460 }}>
        <path
          d={pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(0)},${sy(p[1]).toFixed(0)}`).join("") + "Z"}
          fill="none"
          stroke="#1b232b"
          strokeWidth={stroke * 2.4}
          strokeLinejoin="round"
        />
        {segs.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill="none"
            stroke={s.w === "a" ? colA : s.w === "b" ? colB : "#4a5561"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {track?.corners.map((c) => {
          const cx = c.x * cos - c.y * sin;
          const cy = c.x * sin + c.y * cos;
          const ang = ((c.angle + (track?.rotation ?? 0)) * Math.PI) / 180;
          const off = stroke * 4.2;
          return (
            <text
              key={`${c.number}${c.letter}`}
              x={sx(cx) + off * Math.cos(ang)}
              y={sy(cy) - off * Math.sin(ang)}
              fill="#7d8a97"
              fontSize={stroke * 2.4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {c.number}
              {c.letter}
            </text>
          );
        })}
        <circle cx={sx(pts[0][0])} cy={sy(pts[0][1])} r={stroke * 0.9} fill="#d9e0e7" />
        {cursor != null && pts[cursor] && (
          <circle
            cx={sx(pts[cursor][0])}
            cy={sy(pts[cursor][1])}
            r={stroke * 1.4}
            fill={ACCENT}
            stroke="#06080a"
            strokeWidth={stroke * 0.4}
          />
        )}
      </svg>
    </Panel>
  );
}

function LapSummary({ pair, colA, colB }: { pair: Pair; colA: string; colB: string }) {
  const { a, b } = pair;
  const row = (t: Telemetry, color: string) => {
    const fullThrottle = t.throttle.filter((v) => v >= 98).length / t.throttle.length;
    const braking = t.brake.filter(Boolean).length / t.brake.length;
    return (
      <div className="stat-grid" style={{ marginBottom: 8 }}>
        <Stat
          k="Driver"
          v={<span style={{ color }}>{t.driver}</span>}
          s={
            <>
              lap {t.lap} · <Tyre compound={t.compound} age={t.tyre_age} />
            </>
          }
        />
        <Stat k="Lap time" v={lapTime(t.lap_time)} />
        <Stat k="Top speed" v={`${Math.max(...t.speed)}`} s="km/h" />
        <Stat k="Full throttle" v={`${(fullThrottle * 100).toFixed(0)}%`} s="of samples ≥ 98%" />
        <Stat k="Braking" v={`${(braking * 100).toFixed(0)}%`} s="of samples" />
        <Stat k="Max RPM" v={`${Math.max(...t.rpm)}`} />
      </div>
    );
  };
  return (
    <Panel title="Lap comparison" span={7} sub={`gap ${signed(b.lap_time - a.lap_time, 3)}s`}>
      {row(a, colA)}
      {row(b, colB)}
    </Panel>
  );
}

function CornerTable({ pair, corners, colA, colB }: { pair: Pair; corners: Corner[]; colA: string; colB: string }) {
  if (!corners.length) return null;
  const minNear = (arr: number[], dist: number) => {
    let m = Infinity;
    pair.d.forEach((d, i) => {
      if (Math.abs(d - dist) <= 90 && arr[i] < m) m = arr[i];
    });
    return Number.isFinite(m) ? m : null;
  };
  const deltaAt = (dist: number) => {
    const i = pair.d.findIndex((d) => d >= dist);
    return i >= 0 ? pair.delta[i] : null;
  };
  return (
    <Panel title="Corner apex speeds" span={7} sub="minimum speed within ±90 m of each apex" flush>
      <div className="scroll" style={{ maxHeight: 380 }}>
        <table className="data">
          <thead>
            <tr>
              <th>TURN</th>
              <th className="r">DIST</th>
              <th className="r" style={{ color: colA }}>
                {pair.a.driver}
              </th>
              <th className="r" style={{ color: colB }}>
                {pair.b.driver}
              </th>
              <th className="r">Δ SPEED</th>
              <th className="r">Δ TIME HERE</th>
            </tr>
          </thead>
          <tbody>
            {corners.map((c) => {
              const va = minNear(pair.a.speed, c.distance);
              const vb = minNear(pair.bOn.speed, c.distance);
              const dv = va != null && vb != null ? vb - va : null;
              return (
                <tr key={`${c.number}${c.letter}`}>
                  <td>
                    T{c.number}
                    {c.letter}
                  </td>
                  <td className="r dim">{c.distance.toFixed(0)}m</td>
                  <td className="r">{num(va, 0)}</td>
                  <td className="r">{num(vb, 0)}</td>
                  <td className={`r ${dv != null && dv > 0 ? "up" : dv != null && dv < 0 ? "down" : ""}`}>
                    {signed(dv, 0)}
                  </td>
                  <td className="r muted">{signed(deltaAt(c.distance), 3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Elevation({ track, cursorD }: { track: Track; cursorD: number | null }) {
  const W = 700;
  const H = 150;
  const max = Math.max(...track.elevation, 1);
  const len = track.length;
  const x = (d: number) => (d / len) * (W - 40) + 30;
  const y = (z: number) => H - 20 - (z / max) * (H - 40);
  const path = track.d.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(track.elevation[i]).toFixed(1)}`).join("");
  return (
    <Panel
      title="Elevation profile"
      span={5}
      sub={`${max.toFixed(1)} m change over ${(len / 1000).toFixed(3)} km (from car Z position)`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <path d={`${path}L${x(len)},${H - 20}L${x(0)},${H - 20}Z`} fill="rgba(255,180,0,0.08)" />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.5} />
        {[0, max / 2, max].map((z) => (
          <text key={z} x={2} y={y(z) + 3} fontSize={10} fill="#7d8a97">
            {z.toFixed(0)}m
          </text>
        ))}
        {track.corners.map((c) => (
          <text key={`${c.number}${c.letter}`} x={x(c.distance)} y={H - 6} fontSize={9} fill="#4a5561" textAnchor="middle">
            {c.number}
          </text>
        ))}
        {cursorD != null && (
          <line x1={x(cursorD)} x2={x(cursorD)} y1={10} y2={H - 20} stroke="#d9e0e7" strokeDasharray="2 3" />
        )}
      </svg>
    </Panel>
  );
}
