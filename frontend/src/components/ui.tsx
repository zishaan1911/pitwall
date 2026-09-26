import type { ReactNode } from "react";
import { COMPOUND_COLOR } from "../lib/colors";
import { COMPOUND_SHORT } from "../lib/format";

export function Panel({
  title,
  sub,
  actions,
  span = 12,
  flush,
  note,
  children,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  span?: 4 | 5 | 6 | 7 | 8 | 12;
  flush?: boolean;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`panel span-${span}`}>
      <header>
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        {actions && <div className="actions">{actions}</div>}
      </header>
      <div className={`content${flush ? " flush" : ""}`}>{children}</div>
      {note && <div className="note">{note}</div>}
    </section>
  );
}

export function Tyre({ compound, age }: { compound: string; age?: number | null }) {
  const code = compound.length === 1 ? compound : (COMPOUND_SHORT[compound] ?? "?");
  return (
    <span>
      <span className="tyre" style={{ color: COMPOUND_COLOR[code] ?? COMPOUND_COLOR.U }} title={compound}>
        {code}
      </span>
      {age != null && <span className="tyre-age">{age}</span>}
    </span>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Horizontal stint bar: compound-coloured segments proportional to laps. */
export function StintBar({
  stints,
  total,
  height = 12,
}: {
  stints: { compound: string; laps: number }[];
  total: number;
  height?: number;
}) {
  let x = 0;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none">
      {stints.map((s, i) => {
        const code = COMPOUND_SHORT[s.compound] ?? s.compound;
        const r = (
          <rect
            key={i}
            x={x + 0.15}
            y={0}
            width={Math.max(s.laps - 0.3, 0.2)}
            height={height}
            fill={COMPOUND_COLOR[code] ?? COMPOUND_COLOR.U}
            opacity={0.85}
          />
        );
        x += s.laps;
        return r;
      })}
    </svg>
  );
}
