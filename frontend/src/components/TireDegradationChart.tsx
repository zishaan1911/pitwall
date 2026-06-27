import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { TireDegradationCurve } from "../types";

interface Props {
  curves: TireDegradationCurve[];
  mode: "grip" | "penalty";
}

const LABELS: Record<string, string> = {
  SOFT: "Soft",
  MEDIUM: "Medium",
  HARD: "Hard",
};

export function TireDegradationChart({ curves, mode }: Props) {
  if (!curves.length) return null;

  const maxLaps = Math.max(...curves.map((c) => c.laps.length));
  const data = Array.from({ length: maxLaps }, (_, i) => {
    const point: Record<string, number | string> = { lap: i };
    for (const curve of curves) {
      if (i < curve.laps.length) {
        point[curve.compound] =
          mode === "grip"
            ? parseFloat(curve.grip_pct[i].toFixed(1))
            : parseFloat(curve.time_penalty_s[i].toFixed(3));
      }
    }
    return point;
  });

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="lap"
            stroke="#666"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{ value: "Tire age (laps)", position: "insideBottom", offset: -4, fill: "#666", fontSize: 11 }}
          />
          <YAxis
            stroke="#666"
            tick={{ fill: "#888", fontSize: 11 }}
            domain={mode === "grip" ? [60, 102] : [0, "auto"]}
            label={{
              value: mode === "grip" ? "Grip (%)" : "Time loss (s)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fill: "#666",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }}
            labelStyle={{ color: "#aaa", fontSize: 12 }}
            itemStyle={{ fontSize: 12 }}
            formatter={(val: any) =>
              mode === "grip" ? `${val.toFixed(1)}%` : `+${val.toFixed(2)}s`
            }
            labelFormatter={(l) => `Lap ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#aaa" }} />
          {curves.map((curve) => (
            <Line
              key={curve.compound}
              type="monotone"
              dataKey={curve.compound}
              name={LABELS[curve.compound]}
              stroke={curve.compound === "HARD" ? "#aaa" : curve.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
          {curves.map((curve) => (
            <ReferenceLine
              key={`cliff-${curve.compound}`}
              x={curve.cliff_lap}
              stroke={curve.compound === "HARD" ? "#aaa" : curve.color}
              strokeDasharray="4 4"
              opacity={0.5}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
