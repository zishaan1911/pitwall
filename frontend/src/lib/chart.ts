import type uPlot from "uplot";
import type { StatusPeriod } from "../types";
import { STATUS_COLOR } from "./colors";

export const FONT = "11px 'JetBrains Mono', ui-monospace, monospace";
export const INK = "#7d8a97";
export const GRID = "rgba(125, 138, 151, 0.12)";
export const ACCENT = "#ffb400";

export function axis(extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: INK,
    font: FONT,
    labelFont: FONT,
    grid: { stroke: GRID, width: 1 },
    ticks: { stroke: GRID, width: 1, size: 4 },
    gap: 4,
    size: 42,
    ...extra,
  };
}

export function fade(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return hex.length === 7 ? `${hex}${a}` : hex;
}

/** Shade safety car / VSC / red flag periods, keyed on lap number on the x axis. */
export function statusBands(periods: StatusPeriod[], toX: (p: StatusPeriod) => [number, number] = (p) => [p.lap_start - 0.5, p.lap_end + 0.5]): uPlot.Plugin {
  const shown = periods.filter((p) => p.kind !== "YELLOW");
  return {
    hooks: {
      drawClear: (u) => {
        const { ctx } = u;
        const { top, height } = u.bbox;
        ctx.save();
        for (const p of shown) {
          const [a, b] = toX(p);
          const x0 = u.valToPos(a, "x", true);
          const x1 = u.valToPos(b, "x", true);
          ctx.fillStyle = STATUS_COLOR[p.kind];
          ctx.fillRect(x0, top, Math.max(x1 - x0, 2), height);
          ctx.fillStyle = p.kind === "RED" ? "#ff5c66" : ACCENT;
          ctx.font = `600 ${10 * devicePixelRatio}px 'JetBrains Mono', monospace`;
          ctx.fillText(p.kind, x0 + 4 * devicePixelRatio, top + 12 * devicePixelRatio);
        }
        ctx.restore();
      },
    },
  };
}

/** Vertical marker at the lap selected on the scrubber. */
export function lapMarker(getLap: () => number): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const lap = getLap();
        const x = u.valToPos(lap, "x", true);
        if (!Number.isFinite(x)) return;
        const { ctx } = u;
        const { top, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = devicePixelRatio;
        ctx.setLineDash([3 * devicePixelRatio, 3 * devicePixelRatio]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}

export function baseCursor(sync?: string): uPlot.Cursor {
  return {
    drag: { x: true, y: false, setScale: true },
    points: { size: 5, width: 1 },
    ...(sync ? { sync: { key: sync, setSeries: false } } : {}),
  };
}
