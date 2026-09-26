import { useEffect } from "react";

export function Methods({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Methods" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ letterSpacing: "0.16em" }}>METHODS</b>
          <button className="btn" onClick={onClose}>
            CLOSE ✕
          </button>
        </div>

        <h3>DATA</h3>
        <ul>
          <li>
            <b>FastF1</b>: the official F1 live-timing archive. Lap and sector times, positions, tyre compound and age,
            pit in/out, track status, race control, trackside weather and car telemetry (speed, throttle, brake, gear,
            RPM, DRS and X/Y/Z position).
          </li>
          <li>
            <b>OpenF1</b>: pit lane and stationary times, team radio clips and on-track position exchanges.
          </li>
          <li>
            <b>Jolpica</b> (the Ergast successor): circuit coordinates and the drivers' championship before the round.
          </li>
          <li>
            <b>Open-Meteo</b>: hourly ERA5-based reanalysis at the circuit: cloud cover, solar radiation, precipitation
            and gusts, which the trackside station does not report.
          </li>
        </ul>
        <p>Nothing is simulated. Every number on this page comes from these sources or from a model fitted to them.</p>

        <h3>REPRESENTATIVE LAPS</h3>
        <p>
          A lap counts as clean if it is not lap 1, not an in- or out-lap, was run entirely under green (no yellow, SC,
          VSC or red), is marked accurate by FastF1, and is within 5 s of the driver's median. Everything else is still
          shown in the timing views; it just does not train the model.
        </p>

        <h3>TYRE MODEL</h3>
        <div className="formula">{`t = μ[driver] + κ[compound] + β₁[compound]·age + β₂[compound]·age² + δ·lap + ε`}</div>
        <p>
          <b>μ</b> is each driver/car's pace, <b>κ</b> the compound offset against the most-used compound, <b>β</b> the
          wear curve against tyre age, and <b>δ</b> the per-lap trend from fuel burn and track evolution. δ is identifiable
          separately from wear because tyre age resets at every stop while the lap count keeps rising. The model is fitted by
          iteratively reweighted least squares with Huber weights (k = 1.345), so traffic and small mistakes are
          down-weighted instead of dragging the curve. β₂ is kept only where it is positive and more than 2 standard errors
          from zero. Compounds that no driver paired with another are dropped: their offset would be confounded with driver
          pace.
        </p>

        <h3>PIT LOSS</h3>
        <p>
          Green-flag stops: in-lap + out-lap − the model's prediction for those two laps on track, using the driver's
          own μ and the actual tyre ages. Safety car and VSC stops are measured against the median time of the cars that
          stayed out on the same laps, since the model knows nothing about neutralised pace. The strategy optimiser uses
          the green median.
        </p>

        <h3>STRATEGY OPTIMISER</h3>
        <p>
          Every 1-, 2- and 3-stop plan (at least two dry compounds) is scored as the sum of the fitted wear cost over each
          stint plus stops × pit loss. The δ·lap term is the same for every plan and cancels. Stints are capped at the
          oldest tyre actually run on that compound + 3 laps, so recommendations never rest on long extrapolation. Real
          strategies are scored the same way using their actual tyre ages and the loss for the conditions of each stop.
        </p>

        <h3>LIMITATIONS</h3>
        <ul>
          <li>No tyre–fuel interaction: wear is assumed independent of fuel load, so stint order doesn't change modelled time.</li>
          <li>Traffic is handled statistically (robust weights), not modelled explicitly.</li>
          <li>Safety-car probability is not forecast; the optimiser assumes a green race.</li>
          <li>Wet and mixed races are shown, but the dry optimiser is switched off for them.</li>
        </ul>
      </div>
    </div>
  );
}
