import { createContext, useContext } from "react";
import type { DriverStyle } from "./lib/colors";
import type { Session } from "./types";

export interface RaceCtx {
  session: Session;
  lap: number;
  setLap: (lap: number) => void;
  focus: Set<string>;
  toggleFocus: (code: string) => void;
  styles: Record<string, DriverStyle>;
}

export const RaceContext = createContext<RaceCtx | null>(null);

export function useRace(): RaceCtx {
  const ctx = useContext(RaceContext);
  if (!ctx) throw new Error("useRace outside RaceContext");
  return ctx;
}
