import { useMetric } from '../lib/metric';

/**
 * Switches the shown amounts to metric. Only worth putting on screen for a recipe where it changes something, so
 * callers gate it on hasImperial rather than offering a switch that does nothing.
 */
export function MetricToggle() {
  const [metric, setMetric] = useMetric();
  return (
    <label className="metric-toggle">
      <span>Metric</span>
      <input
        type="checkbox"
        aria-label="Show amounts in metric"
        checked={metric}
        onChange={(e) => setMetric(e.target.checked)}
      />
    </label>
  );
}
