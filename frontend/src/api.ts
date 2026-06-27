import axios from "axios";
import type {
  RaceState,
  OptimalStrategy,
  TireDegradationCurve,
  TrackInfo,
  Compound,
} from "./types";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: BASE });

export async function fetchTracks(): Promise<TrackInfo[]> {
  const { data } = await api.get("/tracks");
  return data.tracks;
}

export async function fetchRaceState(
  track: string,
  lap: number
): Promise<RaceState> {
  const { data } = await api.get(`/race-state/${track}/${lap}`);
  return data;
}

export async function fetchOptimalStrategy(
  track: string,
  compounds: Compound[],
  trackTemp?: number
): Promise<OptimalStrategy> {
  const { data } = await api.post("/optimize-strategy", {
    track,
    compounds,
    track_temp: trackTemp,
    fuel_per_lap: 2.0,
    full_fuel: 110.0,
  });
  return data;
}

export async function fetchTireDegradation(
  compound: Compound,
  track: string,
  trackTemp?: number
): Promise<TireDegradationCurve> {
  const { data } = await api.post("/tire-degradation", {
    compound,
    track,
    track_temp: trackTemp,
    max_laps: 50,
  });
  return data;
}
