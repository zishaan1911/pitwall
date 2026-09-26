import type { CompoundCode, Session, StatusPeriod } from "../types";

export interface TowerRow {
  code: string;
  position: number;
  lapsDone: number;
  gap: number | null; // seconds to leader, null if lapped
  lapsDown: number;
  interval: number | null;
  lastLap: number | null;
  bestLap: number | null;
  compound: CompoundCode;
  age: number | null;
  stops: number;
  inPit: boolean;
  out: boolean;
  s: (number | null)[];
  posChange: number; // vs grid
}

const RUNNING = /^(Finished|Lapped|\+\d+ Laps?)$/;

/**
 * Classification after lap `lap`, as a timing screen shows it once the field
 * has crossed the line: each car is placed on its latest lap up to `lap`, and
 * counts as lapped only if the leader finished lap + 1 before it finished `lap`.
 */
export function towerAt(session: Session, lap: number): TowerRow[] {
  const n = session.leader_ends.length;
  const T = session.leader_ends[Math.min(lap, n) - 1];
  const limit = lap < n ? session.leader_ends[lap] : Infinity;
  const statusByCode = new Map(session.drivers.map((d) => [d.code, d]));
  const rows: (TowerRow & { lastEnd: number })[] = [];

  for (const [code, L] of Object.entries(session.laps)) {
    let k = -1;
    for (let i = 0; i < L.lap.length; i++) {
      const e = L.end[i];
      if (L.lap[i] > lap || (e != null && e > limit)) break;
      if (e != null) k = i;
    }
    if (!L.lap.length) continue;
    // k < 0: still on the opening lap when the leader finished the next one.
    const started = k >= 0;
    const at = Math.max(k, 0);
    const lapsDone = started ? L.lap[k] : 0;
    const lastEnd = (started ? L.end[k] : null) ?? T;
    const drv = statusByCode.get(code);
    const finished = L.lap.length - 1 === k;
    const running = drv ? RUNNING.test(drv.status) : true;
    const out = finished && !running && T > lastEnd + 150;

    let best: number | null = null;
    for (let i = 0; i <= k; i++) {
      const t = L.time[i];
      if (t != null && (best == null || t < best) && !L.pit_in[i] && !L.pit_out[i]) best = t;
    }
    // Tyre stops only: a safety car leading the field through the pit lane is not a stop.
    const stops = session.pit_stops.filter((s) => s.driver === code && s.new_set && s.lap <= lapsDone).length;
    rows.push({
      code,
      position: 0,
      lapsDone,
      gap: null,
      lapsDown: 0,
      interval: null,
      lastLap: started ? L.time[k] : null,
      bestLap: best,
      compound: L.compound[at],
      age: L.age[at],
      stops,
      inPit: started && !!L.pit_in[k],
      out,
      s: started ? [L.s1[k], L.s2[k], L.s3[k]] : [null, null, null],
      posChange: 0,
      lastEnd,
    });
  }

  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    if (a.lapsDone !== b.lapsDone) return b.lapsDone - a.lapsDone;
    return a.lastEnd - b.lastEnd;
  });

  const leader = rows[0];
  rows.forEach((r, i) => {
    r.position = i + 1;
    r.lapsDown = leader ? leader.lapsDone - r.lapsDone : 0;
    r.gap = r.lapsDown === 0 && leader ? r.lastEnd - leader.lastEnd : null;
    const ahead = rows[i - 1];
    r.interval = ahead && !r.out && ahead.lapsDone === r.lapsDone ? r.lastEnd - ahead.lastEnd : null;
    const grid = statusByCode.get(r.code)?.grid;
    r.posChange = grid ? grid - r.position : 0;
  });
  return rows;
}

/** Session time at the end of each lap, per driver (NaN when missing). */
function endsByLap(session: Session, code: string, n: number): number[] {
  const L = session.laps[code];
  const out = Array.from<number>({ length: n }).fill(NaN);
  L.lap.forEach((lap, i) => {
    const e = L.end[i];
    if (lap >= 1 && lap <= n && e != null) out[lap - 1] = e;
  });
  return out;
}

/** Gap to the leader at each lap end. */
export function gapSeries(session: Session): Record<string, (number | null)[]> {
  const n = session.leader_ends.length;
  const out: Record<string, (number | null)[]> = {};
  for (const code of Object.keys(session.laps)) {
    const e = endsByLap(session, code, n);
    out[code] = e.map((v, i) => (Number.isFinite(v) ? v - session.leader_ends[i] : null));
  }
  return out;
}

/**
 * Race history: laps x the winner's average lap minus elapsed time. Flat means
 * on winner pace, falling means losing time; pit stops show as steps down.
 */
export function historySeries(session: Session): Record<string, (number | null)[]> {
  const n = session.leader_ends.length;
  const winner = session.drivers.find((d) => d.position === 1)?.code;
  const start = session.meta.start_s;
  let avg = (session.leader_ends[n - 1] - start) / n;
  if (winner) {
    const w = endsByLap(session, winner, n);
    const last = w.findLastIndex((v) => Number.isFinite(v));
    if (last >= 0) avg = (w[last] - start) / (last + 1);
  }
  const out: Record<string, (number | null)[]> = {};
  for (const code of Object.keys(session.laps)) {
    const e = endsByLap(session, code, n);
    out[code] = e.map((v, i) => (Number.isFinite(v) ? -(v - start - avg * (i + 1)) : null));
  }
  return out;
}

export function positionSeries(session: Session): Record<string, (number | null)[]> {
  const n = session.leader_ends.length;
  const out: Record<string, (number | null)[]> = {};
  for (const [code, L] of Object.entries(session.laps)) {
    const arr = Array.from<number | null>({ length: n }).fill(null);
    L.lap.forEach((lap, i) => {
      if (lap >= 1 && lap <= n) arr[lap - 1] = L.pos[i];
    });
    out[code] = arr;
  }
  return out;
}

export function statusAtLap(periods: StatusPeriod[], lap: number): StatusPeriod | null {
  const rank = { RED: 3, SC: 2, VSC: 1, YELLOW: 0 } as const;
  let best: StatusPeriod | null = null;
  for (const p of periods) {
    if (lap >= p.lap_start && lap <= p.lap_end && (!best || rank[p.kind] > rank[best.kind])) {
      best = p;
    }
  }
  return best;
}

export function weatherAtLap(session: Session, lap: number) {
  const w = session.weather;
  if (!w || !w.t.length) return null;
  let idx = 0;
  for (let i = 0; i < w.lap.length; i++) {
    if (w.lap[i] <= lap) idx = i;
    else break;
  }
  return {
    air: w.air[idx],
    track: w.track[idx],
    humidity: w.humidity[idx],
    wind: w.wind_speed[idx],
    windDir: w.wind_dir[idx],
    rain: !!w.rain[idx],
    pressure: w.pressure[idx],
  };
}

export function fastestLap(session: Session) {
  let best: { code: string; lap: number; time: number } | null = null;
  const disqualified = new Set(session.drivers.filter((d) => /disqualified/i.test(d.status)).map((d) => d.code));
  for (const [code, L] of Object.entries(session.laps)) {
    if (disqualified.has(code)) continue;
    L.time.forEach((t, i) => {
      if (t != null && (!best || t < best.time) && !L.pit_in[i] && !L.pit_out[i]) {
        best = { code, lap: L.lap[i], time: t };
      }
    });
  }
  return best as { code: string; lap: number; time: number } | null;
}

/** Linear interpolation of y(x) at xs (x must be increasing). */
export function interp(x: number[], y: number[], xs: number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    while (j < x.length - 2 && x[j + 1] < v) j++;
    const x0 = x[j];
    const x1 = x[j + 1] ?? x0;
    const t = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
    out[i] = y[j] + (y[j + 1] - y[j]) * Math.min(Math.max(t, 0), 1);
  }
  return out;
}
