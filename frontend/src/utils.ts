export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, "0")}`;
}

export function formatGap(gap: number): string {
  if (gap === 0) return "LEADER";
  return `+${gap.toFixed(3)}s`;
}

export const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#E8002D",
  MEDIUM: "#FFF200",
  HARD: "#C8C8C8",
};

export const TEAM_COLORS: Record<string, string> = {
  "Red Bull": "#3671C6",
  Mercedes: "#27F4D2",
  Ferrari: "#E8002D",
  McLaren: "#FF8000",
  "Aston Martin": "#358C75",
};

export function getCompoundBadgeStyle(compound: string): React.CSSProperties {
  const bg = COMPOUND_COLORS[compound] || "#888";
  const isLight = compound === "MEDIUM" || compound === "HARD";
  return {
    backgroundColor: bg,
    color: isLight ? "#111" : "#fff",
    border: compound === "HARD" ? "1px solid #555" : "none",
  };
}
