// Shapes of the JSON bundles written by backend/pitwall/bundle.py.

export type Kind = "R" | "S";
export type CompoundCode = "S" | "M" | "H" | "I" | "W" | "U";
export type CompoundName = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";

export interface IndexEvent {
  round: number;
  name: string;
  country: string;
  location: string;
  date: string;
  sessions: Kind[];
  built: Kind[];
}

export interface Catalog {
  mode: "live" | "static";
  generated_at: string;
  seasons: { year: number; events: IndexEvent[] }[];
}

export interface SourceStatus {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

export interface Meta {
  year: number;
  round: number;
  kind: Kind;
  session: string;
  event: string;
  official_name: string | null;
  country: string;
  location: string;
  circuit: { id: string; name: string; lat: number; lon: number; wiki?: string } | null;
  date: string;
  start_utc: string;
  end_utc: string;
  start_s: number;
  end_s: number;
  total_laps: number;
  wet: boolean;
  generated_at: string;
  pitwall: string;
  sources: Record<string, SourceStatus>;
}

export interface Driver {
  code: string;
  number: string;
  name: string;
  team: string;
  color: string;
  grid: number | null;
  position: number | null;
  classified: string;
  status: string;
  points: number | null;
  laps: number | null;
}

export interface DriverLaps {
  lap: number[];
  time: (number | null)[];
  end: (number | null)[];
  pos: (number | null)[];
  compound: CompoundCode[];
  age: (number | null)[];
  pit_in: number[];
  pit_out: number[];
  status: string[];
  clean: number[];
  s1: (number | null)[];
  s2: (number | null)[];
  s3: (number | null)[];
  trap: (number | null)[];
}

export interface Stint {
  driver: string;
  stint: number;
  compound: string;
  lap_start: number;
  lap_end: number;
  laps: number;
  age_start: number | null;
  fresh: boolean;
}

export interface StatusPeriod {
  kind: "YELLOW" | "SC" | "VSC" | "RED";
  start: number;
  end: number;
  lap_start: number;
  lap_end: number;
}

export interface Weather {
  t: number[];
  lap: number[];
  air: number[];
  track: number[];
  humidity: number[];
  pressure: number[];
  wind_speed: number[];
  wind_dir: number[];
  rain: number[];
}

export interface WeatherHourly {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  precipitation: number[];
  cloud_cover: number[];
  shortwave_radiation: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  wind_direction_10m: number[];
}

export interface RaceControlMessage {
  t: number;
  lap: number | null;
  category: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  driver: string | null;
  message: string;
}

export interface Radio {
  t: number;
  lap: number;
  driver: string | null;
  url: string;
}

export interface PitStop {
  driver: string;
  lap: number;
  session_time: number | null;
  kind: "GREEN" | "SC" | "VSC" | "RED";
  from: string;
  to: string;
  from_age: number | null;
  new_set: boolean;
  loss: number | null;
  lane: number | null;
  stationary: number | null;
}

export interface LossStat {
  median: number;
  q1: number;
  q3: number;
  n: number;
}

export interface PitLoss {
  GREEN?: LossStat;
  SC?: LossStat;
  VSC?: LossStat;
  lane_median?: number;
  stationary_median?: number;
  stationary_best?: number;
}

export interface CompoundFit {
  offset: number;
  offset_se: number;
  lin: number;
  lin_se: number;
  quad: number;
  quad_se: number;
  quadratic: boolean;
  laps: number;
  age_min: number;
  age_max: number;
  curve: number[];
}

export interface DegPoint {
  driver: string;
  lap: number;
  compound: string;
  age: number;
  value: number;
  weight: number;
}

export interface Model {
  reference: string;
  lap_coef: number;
  lap_se: number;
  sigma: number;
  rmse: number;
  r2: number;
  n: number;
  downweighted: number;
  compounds: Record<string, CompoundFit>;
  driver_pace: { driver: string; delta: number; se: number }[];
  points: DegPoint[];
}

export interface PlanStint {
  compound: string;
  laps: number;
  from: number;
  to: number;
}

export interface Plan {
  stops: number;
  stints: PlanStint[];
  delta: number;
  window: [number, number][];
}

export interface Strategy {
  pit_loss: number;
  compounds: string[];
  ranked: Plan[];
  best_by_stops: Record<string, Plan>;
  one_stop_curve: { laps: number[]; series: Record<string, (number | null)[]> } | null;
}

export interface ActualStrategy {
  driver: string;
  stints: { compound: string; laps: number }[];
  stops: number;
  stop_kinds: string[];
  delta: number;
}

export interface Undercut {
  early: string;
  late: string;
  stop: number;
  early_lap: number;
  late_lap: number;
  gap_before: number;
  gap_after: number;
  gain: number;
  verdict: "UNDERCUT" | "OVERCUT" | "HELD";
}

export interface Standing {
  position: number | null;
  code: string | null;
  name: string;
  team: string | null;
  points: number;
  wins: number;
}

export interface Corner {
  number: number;
  letter: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
}

export interface Track {
  x: number[];
  y: number[];
  d: number[];
  elevation: number[];
  length: number;
  rotation: number;
  corners: Corner[];
}

export interface Session {
  meta: Meta;
  drivers: Driver[];
  laps: Record<string, DriverLaps>;
  leader_ends: number[];
  stints: Stint[];
  track_status: StatusPeriod[];
  weather: Weather | null;
  weather_hourly: WeatherHourly | null;
  race_control: RaceControlMessage[];
  radio: Radio[];
  passes: Record<string, { made: number; lost: number }>;
  pit_stops: PitStop[];
  pit_loss: PitLoss;
  model: Model | null;
  strategy: Strategy | null;
  actual_strategies: ActualStrategy[];
  undercuts: Undercut[];
  standings: { before: Standing[]; after: Standing[] };
  track: Track | null;
  telemetry: { driver: string; lap: number; lap_time: number }[];
}

export interface Telemetry {
  driver: string;
  lap: number;
  lap_time: number;
  compound: string;
  tyre_age: number | null;
  d: number[];
  t: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  x: number[];
  y: number[];
  z: number[];
}
