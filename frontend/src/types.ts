export type Compound = "SOFT" | "MEDIUM" | "HARD";
export type LapFlag = "GREEN" | "SC" | "VSC" | "YELLOW";

export interface PaceModel {
  true_pace: number;
  degradation_per_lap: number;
  r_squared: number;
  predicted_laps: number[];
  predicted_times: number[];
  clean_lap_count: number;
  anomalous_lap_count: number;
}

export interface UndercutThreat {
  laps_until_window: number;
  estimated_benefit_s: number;
}

export interface DriverState {
  driver: string;
  team: string;
  car_number: number;
  position: number;
  current_compound: Compound;
  tire_age: number;
  current_grip_pct: number;
  current_lap_time: number;
  gap_to_leader: number;
  has_pitted: boolean;
  pit_lap: number;
  fuel_load: number;
  lap_times: number[];
  lap_flags: LapFlag[];
  pace_model: PaceModel;
  undercut_threat: UndercutThreat | null;
  compound_color: string;
}

export interface RaceState {
  track: string;
  current_lap: number;
  total_laps: number;
  track_temp: number;
  drivers: DriverState[];
}

export interface PitStop {
  lap: number;
  from_compound: Compound;
  to_compound: Compound;
}

export interface Stint {
  start_lap: number;
  end_lap: number;
  compound: Compound;
  laps: number;
}

export interface OptimalStrategy {
  total_time: number;
  pit_stops: PitStop[];
  stints: Stint[];
  track: string;
  total_laps: number;
  compounds_available: Compound[];
}

export interface TireDegradationCurve {
  compound: Compound;
  track: string;
  track_temp: number;
  laps: number[];
  grip_pct: number[];
  time_penalty_s: number[];
  cliff_lap: number;
  color: string;
}

export interface TrackInfo {
  name: string;
  total_laps: number;
  base_lap_time: number;
  track_temp: number;
}
