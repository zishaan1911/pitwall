import { useEffect, useLayoutEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface Props {
  options: Omit<uPlot.Options, "width" | "height">;
  data: uPlot.AlignedData;
  height: number;
  onCreate?: (u: uPlot) => void;
  className?: string;
}

/**
 * Thin React wrapper around uPlot. The chart is rebuilt when `options` changes
 * (callers memoise it) and updated in place when only `data` changes.
 */
export function UPlot({ options, data, height, onCreate, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const u = new uPlot(
      { ...options, width: Math.max(el.clientWidth, 200), height } as uPlot.Options,
      dataRef.current,
      el,
    );
    plot.current = u;
    onCreate?.(u);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0 && Math.abs(w - u.width) > 1) u.setSize({ width: w, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, height]);

  useEffect(() => {
    if (plot.current && plot.current.data !== data) plot.current.setData(data);
  }, [data]);

  return <div ref={host} className={className ?? "uplot-host"} />;
}
