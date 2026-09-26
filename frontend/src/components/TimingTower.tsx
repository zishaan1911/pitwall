import { useMemo } from "react";
import { useRace } from "../context";
import { lapTime, signed } from "../lib/format";
import { towerAt } from "../lib/race";
import { Tyre } from "./ui";

export function TimingTower() {
  const { session, lap, focus, toggleFocus, styles } = useRace();
  const rows = useMemo(() => towerAt(session, lap), [session, lap]);
  const overallBest = useMemo(
    () => Math.min(...rows.map((r) => r.bestLap ?? Infinity)),
    [rows],
  );

  return (
    <aside className="tower" aria-label="Timing tower">
      <div className="tower-head">
        TIMING <span>after lap {lap} · click to highlight</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>P</th>
            <th>DRIVER</th>
            <th>GAP</th>
            <th>INT</th>
            <th>LAST</th>
            <th>TYRE</th>
            <th title="Pit stops">PIT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = styles[r.code];
            const last =
              r.lastLap != null && r.lastLap === overallBest
                ? "ob"
                : r.lastLap != null && r.lastLap === r.bestLap
                  ? "pb"
                  : "";
            return (
              <tr
                key={r.code}
                className={`${focus.has(r.code) ? "focus" : ""} ${r.out ? "out" : ""}`}
                onClick={() => toggleFocus(r.code)}
              >
                <td className="pos">{r.out ? "—" : r.position}</td>
                <td className="drv">
                  <span className="teambar" style={{ background: st?.color }} />
                  {r.code}
                  {r.posChange !== 0 && !r.out && (
                    <span className={`chg ${r.posChange > 0 ? "up" : "down"}`}>
                      {r.posChange > 0 ? "▲" : "▼"}
                      {Math.abs(r.posChange)}
                    </span>
                  )}
                </td>
                <td>
                  {r.out
                    ? "OUT"
                    : r.position === 1
                      ? <span className="dim">LEADER</span>
                      : r.lapsDown > 0
                        ? `+${r.lapsDown}L`
                        : signed(r.gap, 3)}
                </td>
                <td className="muted">{r.interval != null && r.position > 1 ? signed(r.interval, 3) : ""}</td>
                <td className={last}>
                  {lapTime(r.lastLap)}
                  {r.inPit && <span className="pit-tag">PIT</span>}
                </td>
                <td>
                  <Tyre compound={r.compound} age={r.age} />
                </td>
                <td className="muted">{r.stops}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </aside>
  );
}
