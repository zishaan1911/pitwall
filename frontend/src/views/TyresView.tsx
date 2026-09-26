import { useMemo, useState } from "react";
import { Empty, Panel, Stat, Tyre } from "../components/ui";
import { useRace } from "../context";
import { COMPOUND_COLOR, STATUS_COLOR } from "../lib/colors";
import { COMPOUND_SHORT, num, pm, signed } from "../lib/format";
import { extent, linear, quantile, ticks } from "../lib/scale";

export function TyresView() {
  const { session } = useRace();
  return (
    <div className="view">
      <StintTimeline />
      {session.model ? (
        <>
          <DegradationChart />
          <ModelSummary />
          <CoefficientTable />
          <DriverPace />
        </>
      ) : (
        <Panel title="Tyre model">
          <Empty>Not enough representative green-flag laps to fit a degradation model.</Empty>
        </Panel>
      )}
    </div>
  );
}

function StintTimeline() {
  const { session, lap, styles, focus, toggleFocus } = useRace();
  const total = session.leader_ends.length;
  const order = [...session.drivers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const rowH = 18;
  const left = 46;
  const width = 1000;
  const x = linear([0.5, total + 0.5], [left, width - 8]);
  const height = order.length * rowH + 26;

  return (
    <Panel
      title="Tyre stints"
      sub="every set fitted, by finishing order · faded = used set · ▼ = pit stop"
      note="Compound colours follow Pirelli: red soft, yellow medium, white hard, green intermediate, blue wet."
    >
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
        {session.track_status
          .filter((p) => p.kind !== "YELLOW")
          .map((p, i) => (
            <rect
              key={i}
              x={x(p.lap_start - 0.5)}
              y={0}
              width={Math.max(x(p.lap_end + 0.5) - x(p.lap_start - 0.5), 2)}
              height={height - 20}
              fill={STATUS_COLOR[p.kind]}
            />
          ))}
        {ticks(1, total, 12).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={height - 20} stroke="rgba(125,138,151,0.08)" />
            <text x={x(t)} y={height - 6} fill="#4a5561" fontSize={10} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {order.map((d, row) => {
          const y = row * rowH + 3;
          const stints = session.stints.filter((s) => s.driver === d.code);
          const dim = focus.size > 0 && !focus.has(d.code);
          return (
            <g key={d.code} opacity={dim ? 0.3 : 1} onClick={() => toggleFocus(d.code)} style={{ cursor: "pointer" }}>
              <text x={0} y={y + 11} fill={styles[d.code]?.color} fontSize={11} fontWeight={700}>
                {d.code}
              </text>
              {stints.map((s) => {
                const code = COMPOUND_SHORT[s.compound] ?? "U";
                return (
                  <g key={s.stint}>
                    <rect
                      x={x(s.lap_start - 0.5) + 0.5}
                      y={y}
                      width={Math.max(x(s.lap_end + 0.5) - x(s.lap_start - 0.5) - 1, 1)}
                      height={rowH - 6}
                      fill={COMPOUND_COLOR[code]}
                      opacity={s.fresh ? 0.88 : 0.45}
                    >
                      <title>
                        {`${d.code} stint ${s.stint}: ${s.compound} laps ${s.lap_start}–${s.lap_end} (${s.laps} laps), ${s.fresh ? "new" : `used set, ${s.age_start} laps old`}`}
                      </title>
                    </rect>
                    {s.laps >= 5 && (
                      <text
                        x={x(s.lap_start - 0.5) + 4}
                        y={y + 9.5}
                        fontSize={9}
                        fill="#06080a"
                        fontWeight={700}
                        pointerEvents="none"
                      >
                        {code}
                        {s.laps}
                      </text>
                    )}
                  </g>
                );
              })}
              {session.pit_stops
                .filter((p) => p.driver === d.code && p.new_set)
                .map((p, i) => (
                  <text key={i} x={x(p.lap + 0.5)} y={y - 0.5} fontSize={8} fill="#ffb400" textAnchor="middle">
                    ▼
                  </text>
                ))}
            </g>
          );
        })}
        <line x1={x(lap)} x2={x(lap)} y1={0} y2={height - 20} stroke="#ffb400" strokeDasharray="3 3" />
      </svg>
    </Panel>
  );
}

function DegradationChart() {
  const { session } = useRace();
  const model = session.model!;
  const compounds = Object.keys(model.compounds);
  const [shown, setShown] = useState<Set<string>>(() => new Set(compounds));
  const [showPoints, setShowPoints] = useState(true);

  const W = 760;
  const H = 360;
  const pad = { l: 52, r: 16, t: 14, b: 34 };

  const pts = model.points.filter((p) => shown.has(p.compound));
  const maxAge = Math.max(...compounds.map((c) => model.compounds[c].age_max), 5);
  // Clip the y range to the bulk of the data so a few traffic laps do not flatten the curves.
  const vals = pts.map((p) => p.value).sort((a, b) => a - b);
  const curveVals = compounds.filter((c) => shown.has(c)).flatMap((c) => model.compounds[c].curve);
  const [cLo, cHi] = extent(curveVals);
  const lo = Math.min(quantile(vals, 0.01), cLo) - 0.2;
  const hi = Math.max(quantile(vals, 0.985), cHi) + 0.2;
  const x = linear([0, maxAge + 1], [pad.l, W - pad.r]);
  const y = linear([lo, hi], [H - pad.b, pad.t]);

  return (
    <Panel
      title="Degradation model"
      span={8}
      sub={`lap time vs tyre age, driver- and fuel-corrected, relative to a new ${model.reference}`}
      actions={
        <div className="chips">
          {compounds.map((c) => (
            <button
              key={c}
              className="chip"
              aria-pressed={shown.has(c)}
              style={{ color: shown.has(c) ? COMPOUND_COLOR[c] : undefined }}
              onClick={() =>
                setShown((s) => {
                  const n = new Set(s);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
            >
              {c}
            </button>
          ))}
          <button className="chip" aria-pressed={showPoints} onClick={() => setShowPoints((v) => !v)}>
            LAPS
          </button>
        </div>
      }
      note="Each dot is one clean green-flag lap after removing that driver's pace offset and the per-lap fuel/track trend. Hollow dots were down-weighted by the robust fit (traffic, errors). Lines are the fitted wear curves."
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {ticks(lo, hi, 6).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(125,138,151,0.1)" />
            <text x={pad.l - 6} y={y(t) + 3} fontSize={10} fill="#7d8a97" textAnchor="end">
              {signed(t, 1)}s
            </text>
          </g>
        ))}
        {ticks(0, maxAge, 10).map((t) => (
          <text key={t} x={x(t)} y={H - pad.b + 14} fontSize={10} fill="#7d8a97" textAnchor="middle">
            {t}
          </text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} fontSize={10} fill="#4a5561" textAnchor="middle">
          TYRE AGE (LAPS)
        </text>
        {showPoints &&
          pts.map((p, i) =>
            p.value < lo || p.value > hi ? null : (
              <circle
                key={i}
                cx={x(p.age) + ((i * 7919) % 11) / 11 - 0.5}
                cy={y(p.value)}
                r={2.1}
                fill={p.weight >= 0.5 ? COMPOUND_COLOR[p.compound] : "none"}
                stroke={COMPOUND_COLOR[p.compound]}
                strokeWidth={p.weight >= 0.5 ? 0 : 0.8}
                opacity={p.weight >= 0.5 ? 0.32 : 0.5}
              >
                <title>{`${p.driver} lap ${p.lap} · ${p.compound} age ${p.age} · ${signed(p.value, 3)}s`}</title>
              </circle>
            ),
          )}
        {compounds
          .filter((c) => shown.has(c))
          .map((c) => {
            const f = model.compounds[c];
            const path = f.curve
              .map((v, i) => `${i === 0 ? "M" : "L"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)
              .join("");
            return (
              <g key={c}>
                <path d={path} fill="none" stroke="#06080a" strokeWidth={5} opacity={0.8} />
                <path d={path} fill="none" stroke={COMPOUND_COLOR[c]} strokeWidth={2.4} />
                <text
                  x={x(f.curve.length) + 4}
                  y={y(f.curve[f.curve.length - 1]) + 3}
                  fontSize={10}
                  fill={COMPOUND_COLOR[c]}
                  fontWeight={700}
                >
                  {COMPOUND_SHORT[c]}
                </text>
              </g>
            );
          })}
      </svg>
    </Panel>
  );
}

function ModelSummary() {
  const { session } = useRace();
  const m = session.model!;
  return (
    <Panel title="Fit" span={4} sub="robust least squares, Huber loss">
      <div className="stat-grid">
        <Stat k="Clean laps" v={m.n} s={`${m.downweighted} flagged as outliers`} />
        <Stat k="R²" v={m.r2.toFixed(3)} s="weighted" />
        <Stat k="Residual σ" v={`${m.sigma.toFixed(3)}s`} s={`RMSE ${m.rmse.toFixed(3)}s`} />
        <Stat
          k="Fuel + track / lap"
          v={`${signed(m.lap_coef, 3)}s`}
          s={`± ${m.lap_se.toFixed(4)} · ${num(m.lap_coef * session.meta.total_laps, 1)}s over the race`}
        />
      </div>
      <div className="formula" style={{ marginTop: 10 }}>
        {`t = μ[driver] + κ[cpd] + β₁[cpd]·age
    + β₂[cpd]·age² + δ·lap + ε`}
      </div>
      <p className="dim" style={{ fontSize: 10, lineHeight: 1.6, marginBottom: 0 }}>
        δ absorbs fuel burn-off and track evolution together. It is separable from tyre wear because
        tyre age resets at every stop while the lap count keeps rising. β₂ is kept only where it is
        positive and significant (t &gt; 2).
      </p>
    </Panel>
  );
}

function CoefficientTable() {
  const { session } = useRace();
  const m = session.model!;
  return (
    <Panel title="Compound coefficients" span={7} sub="estimate ± standard error" flush>
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>COMPOUND</th>
              <th className="r">κ OFFSET (s)</th>
              <th className="r">β₁ (s/lap)</th>
              <th className="r">β₂ (s/lap²)</th>
              <th className="r">WEAR @10 LAPS</th>
              <th className="r">LAPS</th>
              <th className="r">AGE RANGE</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(m.compounds).map(([c, f]) => (
              <tr key={c}>
                <td>
                  <Tyre compound={c} /> <span style={{ marginLeft: 6 }}>{c}</span>
                  {c === m.reference && <span className="dim"> · ref</span>}
                </td>
                <td className="r">{c === m.reference ? <span className="dim">0 (ref)</span> : pm(f.offset, f.offset_se)}</td>
                <td className="r">{pm(f.lin, f.lin_se, 4)}</td>
                <td className="r">{f.quadratic ? pm(f.quad, f.quad_se, 5) : <span className="dim">linear</span>}</td>
                <td className="r" title="Marginal lap-time loss per lap at tyre age 10">
                  {signed(f.lin + 2 * f.quad * 10, 3)} s/lap
                </td>
                <td className="r">{f.laps}</td>
                <td className="r">
                  {f.age_min}–{f.age_max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DriverPace() {
  const { session, styles, toggleFocus, focus } = useRace();
  const pace = session.model!.driver_pace;
  const maxDelta = useMemo(() => Math.max(...pace.map((p) => p.delta + p.se), 0.5), [pace]);
  return (
    <Panel
      title="Corrected race pace"
      span={5}
      sub="driver effect μ vs fastest, with 1σ"
      note="Same fuel load, same tyre, same age: what remains is the pace of driver and car on representative laps."
    >
      <div style={{ display: "grid", gap: 3 }}>
        {pace.map((p) => (
          <div
            key={p.driver}
            onClick={() => toggleFocus(p.driver)}
            style={{
              display: "grid",
              gridTemplateColumns: "34px 1fr 64px",
              gap: 8,
              alignItems: "center",
              cursor: "pointer",
              opacity: focus.size && !focus.has(p.driver) ? 0.4 : 1,
            }}
          >
            <b style={{ color: styles[p.driver]?.color }}>{p.driver}</b>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  left: 0,
                  width: `${(p.delta / maxDelta) * 100}%`,
                  background: styles[p.driver]?.color,
                  opacity: 0.75,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 5,
                  height: 2,
                  background: "#d9e0e7",
                  left: `${(Math.max(p.delta - p.se, 0) / maxDelta) * 100}%`,
                  width: `${((Math.min(p.delta + p.se, maxDelta) - Math.max(p.delta - p.se, 0)) / maxDelta) * 100}%`,
                  opacity: 0.6,
                }}
              />
            </div>
            <span className="r" style={{ textAlign: "right" }}>
              {p.delta === 0 ? <span className="accent">REF</span> : `+${p.delta.toFixed(3)}`}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
