import { useMemo, useState } from "react";
import type uPlot from "uplot";
import { UPlot } from "../components/UPlot";
import { Empty, Panel, Seg, Stat, StintBar, Tyre } from "../components/ui";
import { useRace } from "../context";
import { COMPOUND_COLOR } from "../lib/colors";
import { axis, baseCursor, statusBands } from "../lib/chart";
import { COMPOUND_SHORT, num, signed } from "../lib/format";
import { tooltip } from "../lib/tooltip";
import type { Plan } from "../types";

export function StrategyView() {
  const { session } = useRace();
  return (
    <div className="view">
      {session.strategy ? (
        <>
          <Optimiser />
          <PitWindow />
        </>
      ) : (
        <Panel title="Strategy optimiser">
          <Empty>
            {session.meta.wet
              ? "Wet or mixed-conditions race: the dry-compound optimiser does not apply."
              : "Not enough data for a tyre model and a green-flag pit loss in this session."}
          </Empty>
        </Panel>
      )}
      <PitLossPanel />
      <ActualStrategies />
      <PitLedger />
      <Undercuts />
    </div>
  );
}

const seqText = (p: Plan) => p.stints.map((s) => `${COMPOUND_SHORT[s.compound]}${s.laps}`).join(" – ");

function Optimiser() {
  const { session } = useRace();
  const st = session.strategy!;
  const total = session.meta.total_laps;
  return (
    <Panel
      title="Strategy optimiser"
      span={7}
      sub={`every 1–3 stop plan scored on the fitted wear curves + ${st.pit_loss.toFixed(1)}s measured pit loss`}
      note={
        <>
          Exhaustive search over compound sets and stint lengths (min 4 laps, max = oldest tyre run on that compound + 3).
          The fuel/track term is identical for every plan, so it cancels. Stint order doesn't change the modelled time;
          the order shown is one valid sequence. Window = pit laps that keep the plan within 1.0 s of its best.
        </>
      }
      flush
    >
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>STOPS</th>
              <th style={{ width: "34%" }}>PLAN</th>
              <th>STINTS</th>
              <th>PIT WINDOW</th>
              <th className="r">Δ MODEL</th>
            </tr>
          </thead>
          <tbody>
            {st.ranked.map((p, i) => (
              <tr key={i}>
                <td className={i === 0 ? "accent" : "dim"}>{i + 1}</td>
                <td>{p.stops}</td>
                <td>
                  <StintBar stints={p.stints} total={total} />
                </td>
                <td>{seqText(p)}</td>
                <td className="muted">{p.window.map(([a, b]) => (a === b ? `L${a}` : `L${a}–${b}`)).join(" · ")}</td>
                <td className={`r ${i === 0 ? "accent" : ""}`}>{i === 0 ? "OPTIMUM" : `+${p.delta.toFixed(1)}s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PitWindow() {
  const { session } = useRace();
  const curve = session.strategy!.one_stop_curve;
  const best1 = session.strategy!.best_by_stops["1"];
  const keys = useMemo(() => (curve ? Object.keys(curve.series) : []), [curve]);
  const data = useMemo<uPlot.AlignedData>(
    () => (curve ? ([curve.laps, ...keys.map((k) => curve.series[k])] as uPlot.AlignedData) : [[]]),
    [curve, keys],
  );
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      legend: { show: false },
      cursor: baseCursor(),
      scales: { x: { time: false }, y: { range: (_u, min) => [Math.floor(min) - 1, Math.floor(min) + 25] } },
      axes: [axis({ label: "PIT LAP", labelSize: 14, size: 34 }), axis({ values: (_u, t) => t.map((v) => `+${v}s`) })],
      series: [
        { label: "Lap" },
        ...keys.map((k, i) => {
          const [first] = k.split(">");
          return {
            label: k.replace(">", " → "),
            stroke: COMPOUND_COLOR[first],
            width: 2,
            dash: i === 1 ? [6, 4] : undefined,
          } satisfies uPlot.Series;
        }),
      ],
      plugins: [
        statusBands(session.track_status),
        tooltip({ title: (_u, i) => `PIT ON LAP ${i + 1}`, value: (v) => `+${v.toFixed(2)}s`, sortAsc: true }),
      ],
    }),
    [keys, session],
  );
  if (!curve || !best1) {
    return (
      <Panel title="1-stop pit window" span={5}>
        <Empty>No feasible one-stop plan within the observed tyre life.</Empty>
      </Panel>
    );
  }
  return (
    <Panel
      title="1-stop pit window"
      span={5}
      sub={`modelled race time vs pit lap, relative to the overall optimum`}
      note={`Best one-stop: ${seqText(best1)}, +${best1.delta.toFixed(1)}s vs optimum. Gaps in the lines = a stint longer than the tyre data supports. Shaded laps were neutralised in the real race, when a stop cost less.`}
    >
      <UPlot options={options} data={data} height={250} />
      <div className="legend" style={{ marginTop: 6 }}>
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: COMPOUND_COLOR[k.split(">")[0]], opacity: i ? 0.6 : 1 }} />
            {k.replace(">", " → ")}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function PitLossPanel() {
  const { session } = useRace();
  const L = session.pit_loss;
  const discount = L.GREEN && L.SC ? L.GREEN.median - L.SC.median : null;
  return (
    <Panel
      title="Pit loss"
      span={5}
      sub="measured from this race's stops"
      note="Loss = in-lap + out-lap − the model's prediction for those two laps on track. Lane time and stationary time come from OpenF1 where the feed carries them."
    >
      <div className="stat-grid">
        <Stat
          k="Green flag"
          v={L.GREEN ? `${L.GREEN.median.toFixed(1)}s` : "—"}
          s={L.GREEN ? `IQR ${L.GREEN.q1.toFixed(1)}–${L.GREEN.q3.toFixed(1)} · n=${L.GREEN.n}` : "no green stops"}
        />
        <Stat
          k="Under SC"
          v={L.SC ? `${L.SC.median.toFixed(1)}s` : "—"}
          s={L.SC ? `n=${L.SC.n}${discount != null ? ` · saves ${discount.toFixed(1)}s` : ""}` : "no SC stops"}
        />
        <Stat k="Under VSC" v={L.VSC ? `${L.VSC.median.toFixed(1)}s` : "—"} s={L.VSC ? `n=${L.VSC.n}` : "no VSC stops"} />
        <Stat k="Pit lane" v={L.lane_median ? `${L.lane_median.toFixed(1)}s` : "—"} s="median entry → exit" />
        <Stat
          k="Stationary"
          v={L.stationary_median ? `${L.stationary_median.toFixed(2)}s` : "—"}
          s={L.stationary_best ? `best ${L.stationary_best.toFixed(2)}s` : "not in feed"}
        />
      </div>
    </Panel>
  );
}

function ActualStrategies() {
  const { session, styles } = useRace();
  const rows = session.actual_strategies;
  const total = session.meta.total_laps;
  const max = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);
  return (
    <Panel
      title="Real strategies vs model"
      span={7}
      sub="each lead-lap finisher's actual tyre plan, scored with the same model"
      note="Uses the real tyre ages (including used sets from qualifying) and charges each stop the median loss for its conditions: cheaper under a safety car, free under a red flag. Δ excludes driver pace, traffic and incidents: it isolates the tyre call."
      flush
    >
      {rows.length === 0 ? (
        <Empty>No full-distance runners with modelled compounds.</Empty>
      ) : (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>DRIVER</th>
                <th style={{ width: "36%" }}>ACTUAL PLAN</th>
                <th>STOPS</th>
                <th className="r">Δ VS OPTIMUM</th>
                <th style={{ width: "20%" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.driver}>
                  <td style={{ color: styles[r.driver]?.color, fontWeight: 700 }}>{r.driver}</td>
                  <td>
                    <StintBar stints={r.stints} total={total} />
                  </td>
                  <td className="muted">
                    {r.stops}
                    {r.stop_kinds.some((k) => k !== "GREEN") && (
                      <span className="accent"> ({r.stop_kinds.filter((k) => k !== "GREEN").join(", ")})</span>
                    )}
                  </td>
                  <td className="r">{signed(r.delta, 1, "s")}</td>
                  <td>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          left: r.delta >= 0 ? "0%" : undefined,
                          width: `${(Math.abs(r.delta) / max) * 100}%`,
                          background: r.delta < 0 ? "var(--green)" : "var(--muted)",
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PitLedger() {
  const { session, styles, setLap } = useRace();
  const [kind, setKind] = useState<"all" | "GREEN" | "SC" | "VSC">("all");
  const stops = session.pit_stops.filter((s) => kind === "all" || s.kind === kind);
  return (
    <Panel
      title="Pit stop ledger"
      span={7}
      sub={`${session.pit_stops.length} stops · click to jump to the lap`}
      actions={
        <Seg
          value={kind}
          options={[
            { value: "all", label: "ALL" },
            { value: "GREEN", label: "GREEN" },
            { value: "SC", label: "SC" },
            { value: "VSC", label: "VSC" },
          ]}
          onChange={setKind}
        />
      }
      flush
    >
      <div className="scroll" style={{ maxHeight: 380 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="r">LAP</th>
              <th>DRIVER</th>
              <th>COND.</th>
              <th>TYRES</th>
              <th className="r">LANE</th>
              <th className="r">STATIONARY</th>
              <th className="r">LOSS</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={i} onClick={() => setLap(Math.min(s.lap + 1, session.leader_ends.length))} style={{ cursor: "pointer" }}>
                <td className="r">{s.lap}</td>
                <td style={{ color: styles[s.driver]?.color, fontWeight: 700 }}>{s.driver}</td>
                <td className={s.kind === "GREEN" ? "muted" : "accent"}>{s.kind}</td>
                <td>
                  <Tyre compound={s.from} age={s.from_age} /> <span className="dim">→</span> <Tyre compound={s.to} />
                  {!s.new_set && <span className="dim"> no tyre change</span>}
                </td>
                <td className="r">{num(s.lane, 1, "s")}</td>
                <td className="r">{num(s.stationary, 2, "s")}</td>
                <td className="r">{num(s.loss, 1, "s")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Undercuts() {
  const { session, styles } = useRace();
  const rows = session.undercuts.slice(0, 24);
  const swing = (x: number) => (x > 0 ? `${x.toFixed(1)}s behind` : `${(-x).toFixed(1)}s ahead`);
  return (
    <Panel
      title="Undercut / overcut ledger"
      span={5}
      sub="cars within 4 s, stopping ≤ 6 laps apart, green flag"
      note="Gap is the early stopper's position relative to the late stopper: before = lap before the first stop, after = once both have completed their out-laps. Gain = seconds the early stop was worth."
      flush
    >
      {rows.length === 0 ? (
        <Empty>No close pit-stop battles under green flag</Empty>
      ) : (
        <div className="scroll" style={{ maxHeight: 380 }}>
          <table className="data">
            <thead>
              <tr>
                <th>EARLY</th>
                <th>LATE</th>
                <th className="r">LAPS</th>
                <th>BEFORE → AFTER</th>
                <th className="r">GAIN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: styles[r.early]?.color, fontWeight: 700 }}>{r.early}</td>
                  <td style={{ color: styles[r.late]?.color, fontWeight: 700 }}>{r.late}</td>
                  <td className="r muted">
                    {r.early_lap}/{r.late_lap}
                  </td>
                  <td className="muted">
                    {swing(r.gap_before)} → {swing(r.gap_after)}
                  </td>
                  <td className={`r ${r.gain > 0 ? "up" : "down"}`}>{signed(r.gain, 2)}</td>
                  <td>
                    <span className={`verdict ${r.verdict}`}>{r.verdict}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
