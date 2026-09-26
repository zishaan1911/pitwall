import type { Driver } from "../types";

export const COMPOUND_COLOR: Record<string, string> = {
  S: "#ff3b47",
  M: "#ffd21f",
  H: "#e9edf1",
  I: "#3fcf5e",
  W: "#3d8bff",
  U: "#6b7785",
  SOFT: "#ff3b47",
  MEDIUM: "#ffd21f",
  HARD: "#e9edf1",
  INTERMEDIATE: "#3fcf5e",
  WET: "#3d8bff",
  UNKNOWN: "#6b7785",
};

export const STATUS_COLOR: Record<string, string> = {
  SC: "rgba(255, 180, 0, 0.16)",
  VSC: "rgba(255, 180, 0, 0.09)",
  RED: "rgba(255, 59, 71, 0.18)",
  YELLOW: "rgba(255, 210, 31, 0.05)",
};

export interface DriverStyle {
  color: string;
  dash: number[] | undefined;
  second: boolean;
}

/** Team colour per driver; the second driver of each team is drawn dashed. */
export function driverStyles(drivers: Driver[]): Record<string, DriverStyle> {
  const seen = new Set<string>();
  const out: Record<string, DriverStyle> = {};
  const byGrid = [...drivers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  for (const d of byGrid) {
    const second = seen.has(d.team);
    seen.add(d.team);
    out[d.code] = { color: lift(d.color), dash: second ? [5, 4] : undefined, second };
  }
  return out;
}

/** Brighten very dark team colours so they read on the near-black background. */
function lift(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#8a93a0";
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 70) {
    const k = 70 / Math.max(lum, 1);
    r = Math.min(255, Math.round(r * k + 40));
    g = Math.min(255, Math.round(g * k + 40));
    b = Math.min(255, Math.round(b * k + 40));
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
