import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DriverState } from "../types";

interface Props {
  drivers: DriverState[];
  currentLap: number;
}

const DRIVER_COLORS: Record<string, string> = {
  VER: "#3671C6",
  HAM: "#27F4D2",
  LEC: "#E8002D",
  NOR: "#FF8000",
  ALO: "#358C75",
  SAI: "#FF4444",
};

export function GapChart({ drivers, currentLap }: Props) {
  // Build per-lap cumulative gap data (approximated from lap times)
  const data: Record<string, number | string>[] = [];

  if (!drivers.length) return null;

  const leaderTimes = drivers[0].lap_times;

  for (let i = 0; i < currentLap; i++) {
    const point: Record<string, number | string> = { lap: i + 1 };
    for (const driver of drivers) {
      if (i < driver.lap_times.length) {
        // Cumulative gap vs leader
        let gap = 0;
        for (let j = 0; j <= i; j++) {
          if (j < driver.lap_times.length && j < leaderTimes.length) {
            gap += driver.lap_times[j] - leaderTimes[j];
          }
        }
        point[driver.driver] = parseFloat(gap.toFixed(2));
      }
    }
    data.push(point);
  }

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="lap"
            stroke="#666"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{ value: "Lap", position: "insideBottom", offset: -4, fill: "#666", fontSize: 11 }}
          />
          <YAxis
            stroke="#666"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Gap to leader (s)",
              angle: -90,
              position: "insideLeft",
              offset: 14,
              fill: "#666",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }}
            labelStyle={{ color: "#aaa", fontSize: 12 }}
            itemStyle={{ fontSize: 12 }}
            formatter={(val: any) =>
              val >= 0 ? `+${val.toFixed(2)}s` : `${val.toFixed(2)}s`
            }
            labelFormatter={(l) => `Lap ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#aaa" }} />
          {drivers.map((d) => (
            <Line
              key={d.driver}
              type="monotone"
              dataKey={d.driver}
              stroke={DRIVER_COLORS[d.driver] || "#888"}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
