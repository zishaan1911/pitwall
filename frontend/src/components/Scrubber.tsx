import { useEffect, useRef, useState } from "react";
import { useRace } from "../context";
import { compass, num } from "../lib/format";
import { statusAtLap, weatherAtLap } from "../lib/race";

export function Scrubber() {
  const { session, lap, setLap } = useRace();
  const total = session.leader_ends.length;
  const [playing, setPlaying] = useState(false);
  const lapRef = useRef(lap);
  lapRef.current = lap;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = lapRef.current + 1;
      if (next > total) {
        setPlaying(false);
        return;
      }
      setLap(next);
    }, 700);
    return () => window.clearInterval(id);
  }, [playing, total, setLap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
      if (e.key === "ArrowRight") setLap(Math.min(total, lapRef.current + 1));
      else if (e.key === "ArrowLeft") setLap(Math.max(1, lapRef.current - 1));
      else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, setLap]);

  const status = statusAtLap(session.track_status, lap);
  const wx = weatherAtLap(session, lap);
  const pct = (l: number) => ((l - 1) / Math.max(total - 1, 1)) * 100;

  return (
    <div className="scrubber">
      <button
        className="play"
        onClick={() => {
          if (!playing && lap >= total) setLap(1);
          setPlaying((p) => !p);
        }}
        aria-label={playing ? "Pause replay" : "Replay race"}
        title="Replay (space) · step with ← →"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="lapno">
        LAP {String(lap).padStart(2, "0")} <span>/ {total}</span>
      </div>
      <div className="track-bar">
        <div className="rail" />
        {session.track_status
          .filter((p) => p.kind !== "YELLOW")
          .map((p, i) => (
            <div
              key={i}
              className={`band ${p.kind}`}
              style={{
                left: `${pct(p.lap_start)}%`,
                width: `${Math.max(pct(p.lap_end) - pct(p.lap_start), 0.6)}%`,
              }}
              title={`${p.kind} laps ${p.lap_start}–${p.lap_end}`}
            />
          ))}
        <div className="fill" style={{ width: `${pct(lap)}%` }} />
        <div className="knob" style={{ left: `${pct(lap)}%` }} />
        <input
          type="range"
          min={1}
          max={total}
          value={lap}
          onChange={(e) => setLap(Number(e.target.value))}
          aria-label="Race lap"
        />
      </div>
      <span className={`flag ${status?.kind ?? "GREEN"}`}>{status?.kind ?? "GREEN"}</span>
      {wx && (
        <div className="wx">
          <span>AIR <b>{num(wx.air, 1, "°")}</b></span>
          <span>TRK <b>{num(wx.track, 1, "°")}</b></span>
          <span>HUM <b>{num(wx.humidity, 0, "%")}</b></span>
          <span>
            WIND <b>{num(wx.wind, 1)}</b> m/s {compass(wx.windDir)}
          </span>
          <span>RAIN <b className={wx.rain ? "accent" : ""}>{wx.rain ? "YES" : "NO"}</b></span>
        </div>
      )}
    </div>
  );
}
