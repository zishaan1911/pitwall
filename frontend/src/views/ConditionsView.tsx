import { useMemo } from "react";
import type uPlot from "uplot";
import { UPlot } from "../components/UPlot";
import { Empty, Panel, Stat } from "../components/ui";
import { useRace } from "../context";
import { axis, baseCursor, statusBands } from "../lib/chart";
import { COMPOUND_COLOR } from "../lib/colors";
import { compass, num, signed, utcTime } from "../lib/format";
import { extent, linear, ticks } from "../lib/scale";
import { tooltip } from "../lib/tooltip";

export function ConditionsView() {
  const { session } = useRace();
  return (
    <div className="view">
      {session.weather ? (
        <>
          <TemperatureChart />
          <WeatherSummary />
          <WindChart />
          <WindRose />
        </>
      ) : (
        <Panel title="Trackside weather">
          <Empty>No trackside weather in the archive for this session.</Empty>
        </Panel>
      )}
      <Reanalysis />
      <TempVsPace />
      <Neutralisations />
      <Championship />
    </div>
  );
}

/** Minutes since lights out, for weather sampled on the session clock. */
function useMinutes() {
  const { session } = useRace();
  return useMemo(
    () => session.weather?.t.map((t) => (t - session.meta.start_s) / 60) ?? [],
    [session],
  );
}

function minuteBands(session: ReturnType<typeof useRace>["session"]) {
  return statusBands(session.track_status, (p) => [
    (p.start - session.meta.start_s) / 60,
    (p.end - session.meta.start_s) / 60,
  ]);
}

function TemperatureChart() {
  const { session } = useRace();
  const w = session.weather!;
  const minutes = useMinutes();
  const data = useMemo<uPlot.AlignedData>(() => [minutes, w.track, w.air, w.humidity], [minutes, w]);
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      legend: { show: false },
      cursor: baseCursor("wx"),
      scales: { x: { time: false }, hum: { range: [0, 100] } },
      axes: [
        axis({ label: "MINUTES FROM LIGHTS OUT", labelSize: 14, size: 34 }),
        axis({ values: (_u, t) => t.map((v) => `${v}°`) }),
        axis({ scale: "hum", side: 1, grid: { show: false }, values: (_u, t) => t.map((v) => `${v}%`) }),
      ],
      series: [
        {},
        { label: "Track °C", stroke: "#ff7a3d", width: 2 },
        { label: "Air °C", stroke: "#2ec5f5", width: 1.6 },
        { label: "Humidity %", stroke: "#7d8a97", width: 1, dash: [3, 3], scale: "hum" },
      ],
      plugins: [
        minuteBands(session),
        rainBands(w.rain, minutes),
        tooltip({ title: (u, i) => `T+${Math.round(u.data[0][i] as number)} MIN`, value: (v) => v.toFixed(1) }),
      ],
    }),
    [session, w, minutes],
  );
  return (
    <Panel
      title="Track & air temperature"
      span={8}
      sub="trackside station, 1-minute samples"
      note="Orange: track surface, blue: air, dashed: humidity (right axis). Blue shading marks rainfall at the station."
    >
      <UPlot options={options} data={data} height={260} />
    </Panel>
  );
}

function rainBands(rain: number[], x: number[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const { ctx } = u;
        const { top, height } = u.bbox;
        ctx.save();
        ctx.fillStyle = "rgba(61,139,255,0.16)";
        for (let i = 0; i < rain.length; i++) {
          if (!rain[i]) continue;
          const x0 = u.valToPos(x[i], "x", true);
          const x1 = u.valToPos(x[i + 1] ?? x[i] + 1, "x", true);
          ctx.fillRect(x0, top, Math.max(x1 - x0, 1), height);
        }
        ctx.restore();
      },
    },
  };
}

function WeatherSummary() {
  const { session } = useRace();
  const w = session.weather!;
  const [tLo, tHi] = extent(w.track);
  const [aLo, aHi] = extent(w.air);
  const rainMin = w.rain.filter(Boolean).length;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
  return (
    <Panel title="Conditions" span={4} sub="race window">
      <div className="stat-grid">
        <Stat k="Track temp" v={`${num(tHi, 1)}°`} s={`low ${num(tLo, 1)}° · swing ${num(tHi - tLo, 1)}°`} />
        <Stat k="Air temp" v={`${num(aHi, 1)}°`} s={`low ${num(aLo, 1)}°`} />
        <Stat k="Humidity" v={`${num(mean(w.humidity), 0)}%`} s="mean" />
        <Stat k="Pressure" v={`${num(mean(w.pressure), 0)}`} s="mbar mean" />
        <Stat k="Wind" v={`${num(Math.max(...w.wind_speed), 1)}`} s={`m/s peak · mean ${num(mean(w.wind_speed), 1)}`} />
        <Stat k="Rain" v={rainMin ? `${rainMin} min` : "DRY"} s={rainMin ? "station rain flag on" : "no rain recorded"} />
      </div>
    </Panel>
  );
}

function WindChart() {
  const { session } = useRace();
  const w = session.weather!;
  const minutes = useMinutes();
  const data = useMemo<uPlot.AlignedData>(() => [minutes, w.wind_speed], [minutes, w]);
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      legend: { show: false },
      cursor: baseCursor("wx"),
      scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, Math.max(max * 1.2, 2)] } },
      axes: [axis({ size: 30 }), axis({ values: (_u, t) => t.map((v) => `${v}`) })],
      series: [{}, { label: "Wind m/s", stroke: "#b26cff", width: 1.6, fill: "rgba(178,108,255,0.08)" }],
      plugins: [
        minuteBands(session),
        tooltip({
          title: (u, i) => `T+${Math.round(u.data[0][i] as number)} MIN · FROM ${compass(w.wind_dir[i])}`,
          value: (v) => `${v.toFixed(1)} m/s`,
        }),
      ],
    }),
    [session, w],
  );
  return (
    <Panel title="Wind speed" span={8} sub="m/s at the trackside station">
      <UPlot options={options} data={data} height={150} />
    </Panel>
  );
}

function WindRose() {
  const { session } = useRace();
  const w = session.weather!;
  const bins: number[] = Array.from({ length: 16 }, () => 0);
  w.wind_dir.forEach((d, i) => {
    bins[Math.round((((d % 360) + 360) % 360) / 22.5) % 16] += w.wind_speed[i];
  });
  const max = Math.max(...bins, 1e-6);
  const R = 70;
  const c = 90;
  return (
    <Panel title="Wind rose" span={4} sub="direction wind blows from, weighted by speed">
      <svg viewBox="0 0 180 180" width="100%" style={{ display: "block", maxHeight: 200 }}>
        {[0.33, 0.66, 1].map((k) => (
          <circle key={k} cx={c} cy={c} r={R * k} fill="none" stroke="#1b232b" />
        ))}
        {bins.map((v, i) => {
          const a0 = ((i * 22.5 - 11.25 - 90) * Math.PI) / 180;
          const a1 = ((i * 22.5 + 11.25 - 90) * Math.PI) / 180;
          const r = (v / max) * R;
          return (
            <path
              key={i}
              d={`M${c},${c}L${c + r * Math.cos(a0)},${c + r * Math.sin(a0)}A${r},${r} 0 0 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)}Z`}
              fill="#b26cff"
              opacity={0.55}
            />
          );
        })}
        {["N", "E", "S", "W"].map((l, i) => {
          const a = ((i * 90 - 90) * Math.PI) / 180;
          return (
            <text key={l} x={c + (R + 10) * Math.cos(a)} y={c + (R + 10) * Math.sin(a) + 3} fontSize={9} fill="#7d8a97" textAnchor="middle">
              {l}
            </text>
          );
        })}
      </svg>
    </Panel>
  );
}

function Reanalysis() {
  const { session } = useRace();
  const h = session.weather_hourly;
  if (!h || !h.time.length) {
    return (
      <Panel title="Regional weather" span={12}>
        <Empty>Open-Meteo data unavailable for this session.</Empty>
      </Panel>
    );
  }
  const rows: { k: string; unit: string; vals: number[]; max?: number; color: string; why: string }[] = [
    { k: "Cloud cover", unit: "%", vals: h.cloud_cover, max: 100, color: "#7d8a97", why: "less sun on the asphalt" },
    { k: "Solar radiation", unit: "W/m²", vals: h.shortwave_radiation, color: "#ffb400", why: "drives track temperature" },
    { k: "Precipitation", unit: "mm", vals: h.precipitation, color: "#3d8bff", why: "crossover to intermediates" },
    { k: "Air temp (2 m)", unit: "°C", vals: h.temperature_2m, color: "#2ec5f5", why: "engine cooling, tyre warm-up" },
    { k: "Humidity", unit: "%", vals: h.relative_humidity_2m, max: 100, color: "#7d8a97", why: "air density, power" },
    { k: "Wind (10 m)", unit: "m/s", vals: h.wind_speed_10m, color: "#b26cff", why: "balance, braking points" },
    { k: "Gusts", unit: "m/s", vals: h.wind_gusts_10m, color: "#b26cff", why: "car stability" },
  ];
  const start = session.meta.start_utc.slice(0, 13);
  const end = session.meta.end_utc.slice(0, 13);
  return (
    <Panel
      title="Regional weather · Open-Meteo"
      span={12}
      sub={`hourly reanalysis at ${session.meta.circuit?.lat.toFixed(3)}, ${session.meta.circuit?.lon.toFixed(3)} · times UTC · amber = race hours`}
      flush
    >
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>VARIABLE</th>
              {h.time.map((t) => (
                <th key={t} className="r" style={{ color: t.slice(0, 13) >= start && t.slice(0, 13) <= end ? "var(--accent)" : undefined }}>
                  {utcTime(t)}
                </th>
              ))}
              <th>WHY IT MATTERS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const max = r.max ?? Math.max(...r.vals, 1e-6);
              return (
                <tr key={r.k}>
                  <td>
                    {r.k} <span className="dim">{r.unit}</span>
                  </td>
                  {r.vals.map((v, i) => (
                    <td key={i} className="r" style={{ position: "relative" }}>
                      <span
                        style={{
                          position: "absolute",
                          left: 4,
                          right: 4,
                          bottom: 3,
                          height: 2,
                          background: r.color,
                          opacity: 0.2 + 0.8 * Math.min(Math.max(v / max, 0), 1),
                          transformOrigin: "left",
                          transform: `scaleX(${Math.min(Math.max(v / max, 0.02), 1)})`,
                        }}
                      />
                      {v == null ? "—" : Number.isInteger(v) ? v : v.toFixed(1)}
                    </td>
                  ))}
                  <td className="dim">{r.why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TempVsPace() {
  const { session } = useRace();
  const model = session.model;
  const w = session.weather;
  const pts = useMemo(() => {
    if (!model || !w) return [];
    // Residual = corrected lap time minus the fitted wear curve at that age.
    return model.points
      .filter((p) => p.weight >= 0.5)
      .map((p) => {
        const curve = model.compounds[p.compound]?.curve;
        const fit = curve?.[Math.min(p.age, curve.length) - 1];
        let wi = 0;
        for (let i = 0; i < w.lap.length; i++) if (w.lap[i] <= p.lap) wi = i;
        return fit == null ? null : { temp: w.track[wi], res: p.value - fit, compound: p.compound };
      })
      .filter((p): p is { temp: number; res: number; compound: string } => p != null);
  }, [model, w]);

  if (pts.length < 20) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.temp, 0) / n;
  const my = pts.reduce((s, p) => s + p.res, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.temp - mx) * (p.res - my);
    sxx += (p.temp - mx) ** 2;
    syy += (p.res - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const [tLo, tHi] = extent(pts.map((p) => p.temp));
  const W = 520;
  const H = 240;
  const pad = { l: 44, r: 10, t: 10, b: 28 };
  const x = linear([tLo - 0.3, tHi + 0.3], [pad.l, W - pad.r]);
  const y = linear([-1.5, 1.5], [H - pad.b, pad.t]);

  return (
    <Panel
      title="Track temperature vs pace residual"
      span={6}
      sub={`n=${n} · slope ${signed(slope, 3)} s/°C · r = ${r.toFixed(2)}`}
      note="What the tyre model leaves unexplained, against the track temperature at the time. A near-zero r means the fuel/track term already captures the temperature trend; a clear slope suggests the tyres were temperature-sensitive that day."
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {ticks(-1.5, 1.5, 6).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(125,138,151,0.1)" />
            <text x={pad.l - 5} y={y(t) + 3} fontSize={10} fill="#7d8a97" textAnchor="end">
              {signed(t, 1)}
            </text>
          </g>
        ))}
        {ticks(tLo, tHi, 6).map((t) => (
          <text key={t} x={x(t)} y={H - 10} fontSize={10} fill="#7d8a97" textAnchor="middle">
            {t}°
          </text>
        ))}
        {pts.map((p, i) =>
          Math.abs(p.res) > 1.5 ? null : (
            <circle key={i} cx={x(p.temp) + ((i * 7919) % 9) / 9 - 0.5} cy={y(p.res)} r={1.8} fill={COMPOUND_COLOR[p.compound]} opacity={0.35} />
          ),
        )}
        <line
          x1={x(tLo)}
          x2={x(tHi)}
          y1={y(my + slope * (tLo - mx))}
          y2={y(my + slope * (tHi - mx))}
          stroke="#ffb400"
          strokeWidth={2}
        />
      </svg>
    </Panel>
  );
}

function Neutralisations() {
  const { session, setLap } = useRace();
  const periods = session.track_status.filter((p) => p.kind !== "YELLOW");
  const yellows = session.track_status.filter((p) => p.kind === "YELLOW").length;
  return (
    <Panel title="Neutralisations" span={6} sub={`${yellows} local yellow periods not shown`} flush>
      {periods.length === 0 ? (
        <Empty>Green flag race: no safety car, VSC or red flag</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>TYPE</th>
              <th className="r">LAPS</th>
              <th className="r">DURATION</th>
              <th className="r">STOPS TAKEN</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => {
              const stops = session.pit_stops.filter((s) => s.lap >= p.lap_start - 1 && s.lap <= p.lap_end && s.kind !== "GREEN" && s.new_set).length;
              const dur = p.end - p.start;
              return (
                <tr key={i} onClick={() => setLap(p.lap_start)} style={{ cursor: "pointer" }}>
                  <td className={p.kind === "RED" ? "down" : "accent"}>{p.kind}</td>
                  <td className="r">
                    {p.lap_start === p.lap_end ? p.lap_start : `${p.lap_start}–${p.lap_end}`}
                  </td>
                  <td className="r">{dur >= 60 ? `${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s` : `${Math.round(dur)}s`}</td>
                  <td className="r">{stops}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Championship() {
  const { session, styles } = useRace();
  const { before, after: afterRaw } = session.standings;
  if (!afterRaw.length) {
    return (
      <Panel title="Championship" span={6}>
        <Empty>{session.meta.kind === "R" ? "Standings not available from Jolpica yet" : "Shown for Grand Prix sessions"}</Empty>
      </Panel>
    );
  }
  const prev = new Map(before.map((s) => [s.name, s]));
  const after = afterRaw.map((s, i) => ({
    ...s,
    newPos: s.position ?? i + 1,
    oldPos: prev.get(s.name)?.position ?? null,
    before: prev.get(s.name)?.points ?? 0,
  }));
  const leader = after[0]?.points ?? 0;
  return (
    <Panel title="Championship" span={6} sub="drivers' standings after this round, sprint included (Jolpica)" flush>
      <div className="scroll" style={{ maxHeight: 340 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="r">POS</th>
              <th>DRIVER</th>
              <th className="r">BEFORE</th>
              <th className="r">+ WEEKEND</th>
              <th className="r">AFTER</th>
              <th className="r">TO LEADER</th>
            </tr>
          </thead>
          <tbody>
            {after.slice(0, 12).map((s) => {
              const moved = s.oldPos ? s.oldPos - s.newPos : 0;
              return (
                <tr key={s.name}>
                  <td className="r">
                    {s.newPos}
                    {moved !== 0 && <span className={`chg ${moved > 0 ? "up" : "down"}`}>{moved > 0 ? "▲" : "▼"}{Math.abs(moved)}</span>}
                  </td>
                  <td>
                    <b style={{ color: s.code ? styles[s.code]?.color : undefined }}>{s.code}</b> <span className="muted">{s.name}</span>
                  </td>
                  <td className="r muted">{s.before}</td>
                  <td className="r">{s.points > s.before ? `+${s.points - s.before}` : ""}</td>
                  <td className="r">{s.points}</td>
                  <td className="r dim">{s.points === leader ? "—" : `−${leader - s.points}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
