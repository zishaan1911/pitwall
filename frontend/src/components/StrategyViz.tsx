import type { OptimalStrategy } from "../types";
import { COMPOUND_COLORS } from "../utils";

interface Props {
  strategy: OptimalStrategy;
}

export function StrategyViz({ strategy }: Props) {
  const { stints, pit_stops, total_laps, total_time } = strategy;

  const totalMins = Math.floor(total_time / 60);
  const totalSecs = (total_time % 60).toFixed(1);

  return (
    <div>
      {/* Summary */}
      <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="stat-block">
          <span className="stat-label">Predicted race time</span>
          <span className="stat-value">{totalMins}:{totalSecs.padStart(4, "0")}</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Pit stops</span>
          <span className="stat-value">{pit_stops.length}</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Stints</span>
          <span className="stat-value">{stints.length}</span>
        </div>
      </div>

      {/* Stint bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>OPTIMAL STINT PLAN</div>
        <div
          style={{
            display: "flex",
            height: 36,
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid #333",
          }}
        >
          {stints.map((stint, i) => {
            const width = (stint.laps / total_laps) * 100;
            const color = COMPOUND_COLORS[stint.compound];
            const isLight = stint.compound === "MEDIUM" || stint.compound === "HARD";
            return (
              <div
                key={i}
                style={{
                  width: `${width}%`,
                  backgroundColor: color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: isLight ? "#111" : "#fff",
                  borderRight: i < stints.length - 1 ? "2px solid #111" : "none",
                  position: "relative",
                  minWidth: 28,
                }}
                title={`${stint.compound} — Laps ${stint.start_lap}–${stint.end_lap} (${stint.laps} laps)`}
              >
                {stint.laps >= 8 ? stint.compound[0] : ""}
              </div>
            );
          })}
        </div>

        {/* Lap markers */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "#555" }}>L1</span>
          {pit_stops.map((p) => (
            <span key={p.lap} style={{ fontSize: 10, color: "#e8002d" }}>
              ▲ L{p.lap}
            </span>
          ))}
          <span style={{ fontSize: 10, color: "#555" }}>L{total_laps}</span>
        </div>
      </div>

      {/* Stint detail table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #333" }}>
            {["Stint", "Compound", "Start", "End", "Laps"].map((h) => (
              <th
                key={h}
                style={{ textAlign: "left", padding: "6px 8px", color: "#666", fontWeight: 500 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stints.map((s, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #222" }}>
              <td style={{ padding: "6px 8px", color: "#888" }}>{i + 1}</td>
              <td style={{ padding: "6px 8px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 4,
                    backgroundColor: COMPOUND_COLORS[s.compound],
                    color: s.compound === "SOFT" ? "#fff" : "#111",
                    fontSize: 11,
                    fontWeight: 600,
                    border: s.compound === "HARD" ? "1px solid #555" : "none",
                  }}
                >
                  {s.compound}
                </span>
              </td>
              <td style={{ padding: "6px 8px", color: "#ccc" }}>{s.start_lap}</td>
              <td style={{ padding: "6px 8px", color: "#ccc" }}>{s.end_lap}</td>
              <td style={{ padding: "6px 8px", color: "#ccc" }}>{s.laps}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pit_stops.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>PIT WINDOWS</div>
          {pit_stops.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid #222",
                fontSize: 12,
              }}
            >
              <span style={{ color: "#e8002d", fontWeight: 600 }}>Stop {i + 1}</span>
              <span style={{ color: "#888" }}>Lap {p.lap}</span>
              <span style={{ color: "#555" }}>→</span>
              <span style={{ color: "#aaa" }}>
                {p.from_compound} → {p.to_compound}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
