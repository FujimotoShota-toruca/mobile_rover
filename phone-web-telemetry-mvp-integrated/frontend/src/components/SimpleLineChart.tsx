import { useMemo } from "react";

type Props = {
  title: string;
  values: number[];
  min?: number;
  max?: number;
};

export function SimpleLineChart({ title, values, min, max }: Props) {
  const { path, yMin, yMax, latest } = useMemo(() => {
    const clean = values.slice(-80);
    const localMin = min ?? Math.min(...clean, 0);
    const localMax = max ?? Math.max(...clean, 1);
    const range = Math.max(localMax - localMin, 1e-6);
    const width = 300;
    const height = 120;

    const d = clean
      .map((value, index) => {
        const x = clean.length <= 1 ? 0 : (index / (clean.length - 1)) * width;
        const y = height - ((value - localMin) / range) * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return {
      path: d,
      yMin: localMin,
      yMax: localMax,
      latest: clean.length > 0 ? clean[clean.length - 1] : 0,
    };
  }, [values, min, max]);

  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <strong>{title}</strong>
        <span>{latest.toFixed(3)}</span>
      </div>
      <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="mini-chart-svg">
        <line x1="0" y1="60" x2="300" y2="60" className="grid-line" />
        <path d={path} className="chart-line" />
      </svg>
      <div className="mini-chart-footer">
        <span>{yMin.toFixed(2)}</span>
        <span>{yMax.toFixed(2)}</span>
      </div>
    </div>
  );
}
