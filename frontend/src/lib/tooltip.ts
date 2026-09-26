import type uPlot from "uplot";

interface Opts {
  title: (u: uPlot, idx: number) => string;
  value: (v: number) => string;
  sortAsc?: boolean;
  max?: number;
}

/** Floating readout listing every visible series at the cursor, sorted by value. */
export function tooltip({ title, value, sortAsc = false, max = 22 }: Opts): uPlot.Plugin {
  let el: HTMLDivElement;
  return {
    hooks: {
      init: (u) => {
        el = document.createElement("div");
        el.className = "u-tip";
        el.style.display = "none";
        u.over.appendChild(el);
        u.over.addEventListener("mouseleave", () => (el.style.display = "none"));
      },
      setCursor: (u) => {
        const idx = u.cursor.idx;
        if (idx == null || u.cursor.left == null || u.cursor.left < 0) {
          el.style.display = "none";
          return;
        }
        const rows: { label: string; v: number; color: string }[] = [];
        u.series.forEach((s, i) => {
          if (i === 0 || !s.show) return;
          const v = u.data[i][idx];
          if (v == null || !Number.isFinite(v)) return;
          const stroke = typeof s.stroke === "function" ? s.stroke(u, i) : s.stroke;
          rows.push({ label: String(s.label ?? ""), v: v as number, color: String(stroke ?? "#fff") });
        });
        rows.sort((a, b) => (sortAsc ? a.v - b.v : b.v - a.v));
        el.innerHTML =
          `<div class="u-tip-h">${title(u, idx)}</div>` +
          rows
            .slice(0, max)
            .map(
              (r) =>
                `<div class="u-tip-r"><i style="background:${r.color}"></i><span>${r.label}</span><b>${value(r.v)}</b></div>`,
            )
            .join("");
        el.style.display = "block";
        const left = u.cursor.left;
        const w = el.offsetWidth;
        const x = left + 16 + w > u.over.clientWidth ? left - w - 16 : left + 16;
        el.style.transform = `translate(${x}px, 4px)`;
      },
    },
  };
}
