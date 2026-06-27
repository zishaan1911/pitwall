import type { DriverState } from "../types";
import { formatTime, formatGap, COMPOUND_COLORS } from "../utils";

interface Props {
  drivers: DriverState[];
}

const TEAM_COLORS: Record<string, string> = {
  "Red Bull": "#3671C6",
  Mercedes: "#27F4D2",
  Ferrari: "#E8002D",
  McLaren: "#FF8000",
  "Aston Martin": "#358C75",
};

export function TimingTower({ drivers }: Props) {
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #333" }}>
            {["P", "Driver", "Tyre", "Age", "Grip", "Last Lap", "Gap", "Alert"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h === "P" || h === "Age" || h === "Grip" ? "center" : "left",
                  padding: "6px 8px",
                  color: "#555",
                  fontWeight: 500,
                  fontSize: 10,
                  letterSpacing: "0.05em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const isLowGrip = d.current_grip_pct < 80;
            const compColor = COMPOUND_COLORS[d.current_compound];
            const isLightComp = d.current_compound !== "SOFT";
            const teamColor = TEAM_COLORS[d.team] || "#888";

            return (
              <tr
                key={d.driver}
                style={{
                  borderBottom: "1px solid #1e1e1e",
                  background: d.undercut_threat ? "rgba(255,140,0,0.05)" : "transparent",
                }}
              >
                <td style={{ textAlign: "center", padding: "8px 8px", color: "#888" }}>
                  {d.position}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 3,
                        height: 18,
                        borderRadius: 2,
                        backgroundColor: teamColor,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "#fff", fontWeight: 600 }}>{d.driver}</span>
                  </div>
                </td>
                <td style={{ padding: "8px 8px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 7px",
                      borderRadius: 4,
                      backgroundColor: compColor,
                      color: isLightComp ? "#111" : "#fff",
                      fontWeight: 700,
                      fontSize: 10,
                      border: d.current_compound === "HARD" ? "1px solid #666" : "none",
                    }}
                  >
                    {d.current_compound[0]}
                  </span>
                </td>
                <td style={{ textAlign: "center", padding: "8px 8px", color: "#aaa" }}>
                  {d.tire_age}
                </td>
                <td style={{ textAlign: "center", padding: "8px 8px" }}>
                  <span style={{ color: isLowGrip ? "#ff6b35" : "#4caf50", fontWeight: 500 }}>
                    {d.current_grip_pct.toFixed(0)}%
                  </span>
                </td>
                <td style={{ padding: "8px 8px", color: "#ccc", fontFamily: "monospace" }}>
                  {formatTime(d.current_lap_time)}
                </td>
                <td style={{ padding: "8px 8px", color: d.position === 1 ? "#ffd700" : "#888" }}>
                  {formatGap(d.gap_to_leader)}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  {d.undercut_threat && (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 7px",
                        borderRadius: 4,
                        backgroundColor: "rgba(255,140,0,0.15)",
                        color: "#ff8c00",
                        fontSize: 10,
                        fontWeight: 600,
                        border: "1px solid rgba(255,140,0,0.3)",
                      }}
                    >
                      ↓ UNDERCUT L{d.pit_lap}
                    </span>
                  )}
                  {isLowGrip && !d.undercut_threat && (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 7px",
                        borderRadius: 4,
                        backgroundColor: "rgba(255,60,0,0.12)",
                        color: "#ff6b35",
                        fontSize: 10,
                        border: "1px solid rgba(255,60,0,0.25)",
                      }}
                    >
                      TYRE DEG
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
