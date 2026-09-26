export function lapTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

export function signed(x: number | null | undefined, digits = 3, unit = ""): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = x.toFixed(digits);
  return `${x > 0 ? "+" : x < 0 ? "" : "±"}${v}${unit}`;
}

export function num(x: number | null | undefined, digits = 1, unit = ""): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x.toFixed(digits)}${unit}`;
}

export function pm(value: number, se: number, digits = 3): string {
  return `${signed(value, digits)} ± ${se.toFixed(digits)}`;
}

export function clock(sessionSeconds: number, startSeconds: number): string {
  const s = Math.max(0, sessionSeconds - startSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function utcTime(iso: string): string {
  return iso.slice(11, 16);
}

export const COMPOUND_NAME: Record<string, string> = {
  S: "SOFT",
  M: "MEDIUM",
  H: "HARD",
  I: "INTERMEDIATE",
  W: "WET",
  U: "UNKNOWN",
};

export const COMPOUND_SHORT: Record<string, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
  UNKNOWN: "?",
};

export function compass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
