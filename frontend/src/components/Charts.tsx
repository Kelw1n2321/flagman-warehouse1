import { useState } from 'react';

// Палитра графиков (validate_palette.js: пары primary/secondary и primary/rejected проходят CVD и контраст).
export const SERIES = {
  primary: '#2a6ea8',
  secondary: '#c86a1e',
  rejected: '#c0392b',
  grid: 'rgba(0,0,0,0.12)',
  axis: '#555',
};

interface LinePoint {
  label: string;
  value: number;
}

/** Линия остатка с порогом минимума; перекрестие и подсказка при наведении. */
export function LineChart({
  points,
  format,
  threshold,
  thresholdLabel,
  height = 170,
  ariaLabel,
}: {
  points: LinePoint[];
  format: (v: number) => string;
  threshold?: number;
  thresholdLabel?: string;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 24 };
  const max = Math.max(1e-9, ...points.map((p) => p.value), threshold ?? 0) * 1.1;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = [0, 0.5, 1].map((f) => max * f / 1.1);
  const step = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={SERIES.grid} />
            <text x={pad.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill={SERIES.axis}>
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill={SERIES.axis}>
              {p.label}
            </text>
          ) : null,
        )}
        {threshold !== undefined && threshold > 0 && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke="#b3302a" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - pad.r} y={y(threshold) - 4} fontSize="11" textAnchor="end" fill="#8c231e">
              {thresholdLabel}
            </text>
          </g>
        )}
        <path d={area} fill={SERIES.primary} opacity={0.14} />
        <path d={path} fill="none" stroke={SERIES.primary} strokeWidth={2} />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#333" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r={5} fill={SERIES.primary} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{points[hover].label}</b>
          <span>{format(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

interface BarSeries {
  key: string;
  label: string;
  color: string;
}

/** Сгруппированные столбцы по дням (одна ось Y, общая шкала у всех серий). */
export function BarChart<T extends { date: string }>({
  data,
  series,
  height = 190,
  ariaLabel,
}: {
  data: T[];
  series: BarSeries[];
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const val = (d: T, k: string) => Number((d as Record<string, unknown>)[k] ?? 0);
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => val(d, s.key))));
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const gap = 2;
  const bw = Math.max(3, Math.min(22, (band - 8) / series.length - gap));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), max];
  const step = Math.max(1, Math.ceil(data.length / 10));
  const label = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);

  return (
    <div style={{ position: 'relative' }}>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={SERIES.grid} />
            <text x={pad.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill={SERIES.axis}>
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.l + i * band + (band - series.length * (bw + gap)) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill={hover === i ? 'rgba(0,0,0,0.05)' : 'transparent'} />
              {series.map((s, j) => {
                const v = val(d, s.key);
                const top = y(v);
                const h = Math.max(0, y(0) - top);
                return v > 0 ? (
                  <path
                    key={s.key}
                    d={`M${x0 + j * (bw + gap)},${y(0)} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${Math.max(0, h - 3)} z`}
                    fill={s.color}
                  />
                ) : null;
              })}
              {i % step === 0 && (
                <text x={pad.l + i * band + band / 2} y={H - 6} fontSize="11" textAnchor="middle" fill={SERIES.axis}>
                  {label(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + (hover + 0.5) * band) / W) * 100}%` }}>
          <b>{label(data[hover].date)}</b>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.label}: {val(data[hover], s.key)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
