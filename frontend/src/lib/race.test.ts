import { describe, expect, it } from "vitest";
import type { DriverLaps, Session } from "../types";
import { lapTime, signed } from "./format";
import { interp, statusAtLap, towerAt } from "./race";

function laps(ends: number[], extra: Partial<DriverLaps> = {}): DriverLaps {
  const n = ends.length;
  const fill = <T,>(v: T) => Array.from({ length: n }, () => v);
  return {
    lap: ends.map((_, i) => i + 1),
    time: ends.map((e, i) => e - (i ? ends[i - 1] : 0)),
    end: ends,
    pos: fill(null),
    compound: fill("M"),
    age: ends.map((_, i) => i + 1),
    pit_in: fill(0),
    pit_out: fill(0),
    status: fill("1"),
    clean: fill(1),
    s1: fill(null),
    s2: fill(null),
    s3: fill(null),
    trap: fill(null),
    ...extra,
  };
}

// Three-lap race, 90 s laps. BBB is 5 s behind; CCC is 100 s behind (lapped
// once the leader starts lap 2); DDD retires after lap 1.
const session = {
  meta: { start_s: 0 },
  drivers: [
    { code: "AAA", status: "Finished", grid: 2 },
    { code: "BBB", status: "Finished", grid: 1 },
    { code: "CCC", status: "Lapped", grid: 3 },
    { code: "DDD", status: "Engine", grid: 4 },
  ],
  leader_ends: [90, 180, 270],
  laps: {
    AAA: laps([90, 180, 270]),
    BBB: laps([95, 185, 275]),
    CCC: laps([190, 290]),
    DDD: laps([92]),
  },
  pit_stops: [],
  track_status: [],
} as unknown as Session;

describe("towerAt", () => {
  it("places the field after the leader's lap, not at the leader's crossing", () => {
    const rows = towerAt(session, 3);
    expect(rows.map((r) => r.code)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(rows[1].gap).toBeCloseTo(5);
    expect(rows[1].lapsDown).toBe(0);
  });

  it("marks a car lapped only when the leader finished the next lap first", () => {
    const rows = towerAt(session, 1);
    const ccc = rows.find((r) => r.code === "CCC")!;
    // CCC crossed lap 1 at 190 s, after the leader finished lap 2 (180 s).
    expect(ccc.lapsDown).toBe(1);
    expect(ccc.gap).toBeNull();
  });

  it("drops retirements to the bottom without an interval", () => {
    const ddd = towerAt(session, 3).find((r) => r.code === "DDD")!;
    expect(ddd.out).toBe(true);
    expect(ddd.interval).toBeNull();
  });

  it("reports positions gained against the grid", () => {
    const rows = towerAt(session, 3);
    expect(rows.find((r) => r.code === "AAA")!.posChange).toBe(1);
    expect(rows.find((r) => r.code === "BBB")!.posChange).toBe(-1);
  });
});

describe("helpers", () => {
  it("interpolates linearly and clamps at the ends", () => {
    expect(interp([0, 10], [0, 100], [-5, 0, 2.5, 10, 20])).toEqual([0, 0, 25, 100, 100]);
  });

  it("formats lap times and signed deltas", () => {
    expect(lapTime(92.608)).toBe("1:32.608");
    expect(lapTime(null)).toBe("—");
    expect(signed(0.4, 3)).toBe("+0.400");
    expect(signed(-1.25, 2, "s")).toBe("-1.25s");
  });

  it("picks the most severe neutralisation covering a lap", () => {
    const p = [
      { kind: "YELLOW", lap_start: 4, lap_end: 6, start: 0, end: 0 },
      { kind: "SC", lap_start: 5, lap_end: 8, start: 0, end: 0 },
    ] as Session["track_status"];
    expect(statusAtLap(p, 5)?.kind).toBe("SC");
    expect(statusAtLap(p, 4)?.kind).toBe("YELLOW");
    expect(statusAtLap(p, 9)).toBeNull();
  });
});
