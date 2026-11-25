import { useState, type ReactNode } from 'react';

/** Hand-drawn SVG charts in the LeaderOS manner: hairline grid, tabular numbers, one tooltip, no chart library. */

export interface Seg {
  key: string;
  label: string;
  color: string;
  value: number;
}
export interface Bucket {
  key: string;
  label: string;
  /** Long label for the tooltip. */
  title: string;
  segs: Seg[];
}

function niceMax(v: number, step: number) {
  if (v <= 0) return step;
  const raw = v / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw / step)));
  const n = [1, 2, 2.5, 5, 10].find((k) => k * mag * step >= raw) ?? 10;
  return n * mag * step * 4;
}

/**
 * Pixel heights for one stacked bar. Slivers under 6px can't hold a rounded piece and a gap, so they are left out;
 * a bar made only of slivers becomes one small piece in its biggest colour.
 */
function barSegs(segs: Seg[], max: number, plotH: number) {
  const px = segs.map((s) => ({ key: s.key, color: s.color, h: (s.value / max) * plotH }));
  const total = px.reduce((t, s) => t + s.h, 0);
  const shown = px.filter((s) => s.h >= 6).map((s) => ({ ...s, h: s.h - 2 }));
  if (shown.length || total < 1.5) return shown;
  const big = px.reduce((a, b) => (b.h > a.h ? b : a));
  return [{ key: big.key, color: big.color, h: Math.max(3, total) }];
}

/** Stacked vertical bars with a hover tooltip listing each segment. */
export function StackedBars({
  buckets,
  format,
  axisFormat = format,
  unit = 1,
  height = 220,
  emptyLabel = 'Nothing tracked in this period.',
}: {
  buckets: Bucket[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** Grid lines land on multiples of this (e.g. one hour in ms). */
  unit?: number;
  height?: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = buckets.map((b) => b.segs.reduce((s, x) => s + x.value, 0));
  const max = niceMax(Math.max(0, ...totals), unit);
  const W = 1000;
  const H = height;
  const padL = 0;
  /** Room for the y labels, in px: a fixed gutter, so narrow cards never put bars under the labels. */
  const AX = 44;
  const padB = 24;
  const plotH = H - padB - 8;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Callers that blank some labels have chosen which to show; otherwise thin them to about 16.
  const labelEvery = buckets.some((b) => !b.label) ? 1 : Math.ceil(buckets.length / 16);
  const empty = totals.every((t) => t === 0);

  return (
    <div className="fo-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="fo-chart-svg" style={{ height: H, marginLeft: AX, width: `calc(100% - ${AX}px)` }} role="img" aria-label="Bar chart">
        {ticks.map((t) => {
          const y = 8 + plotH - (t / max) * plotH;
          return <line key={t} x1={padL} x2={W} y1={y} y2={y} className="fo-grid" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {/* Bars in HTML so their rounded ends never stretch with the SVG: separate rounded segments, a 2px gap between. */}
      <div className="fo-bars" style={{ left: AX, top: 8, height: plotH }}>
        {buckets.map((b, i) => (
          <div
            key={b.key}
            className="fo-bars-slot"
            data-dim={hover !== null && hover !== i}
            style={{ ['--i' as string]: i }}
            onMouseEnter={() => setHover(i)}
          >
            <div className="fo-bars-bar" style={{ width: `${Math.min(70, Math.max(34, 2600 / Math.max(1, buckets.length)))}%` }}>
              {barSegs(b.segs, max, plotH).map((s) => (
                <span key={s.key} style={{ height: s.h, ['--c' as string]: s.color }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Axis text lives in HTML so it never stretches with the SVG. */}
      <div className="fo-chart-y" style={{ height: plotH, top: 8 }}>
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <span key={t}>{axisFormat(t)}</span>
          ))}
      </div>
      <div className="fo-chart-x" style={{ left: AX }}>
        {buckets.map((b, i) => (
          <span key={b.key} style={{ width: `${100 / buckets.length}%` }} data-hover={hover === i}>
            {i % labelEvery === 0 ? b.label : ''}
          </span>
        ))}
      </div>
      {empty && <div className="fo-chart-empty">{emptyLabel}</div>}
      {hover !== null && totals[hover] > 0 && (
        <div
          className="fo-tip"
          style={{
            left: `calc(${AX}px + (100% - ${AX}px) * ${(hover + 0.5) / buckets.length})`,
            transform: hover > buckets.length * 0.66 ? 'translateX(-100%)' : hover < buckets.length * 0.33 ? 'none' : 'translateX(-50%)',
          }}
        >
          <div className="fo-tip-title">
            {buckets[hover].title}
            <b>{format(totals[hover])}</b>
          </div>
          {buckets[hover].segs
            .filter((s) => s.value > 0)
            .slice()
            .reverse()
            .map((s) => (
              <div key={s.key} className="fo-tip-row">
                <span className="fo-tip-dot" style={{ background: s.color }} />
                <span className="fo-tip-label">{s.label}</span>
                <span>{format(s.value)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Day × hour grid. `values[row][hour]` in ms; cells shade from hairline to ink. */
export function Heatmap({
  rows,
  values,
  totals,
  format,
  color = '#3b5bdb',
  height,
  cellTip,
}: {
  rows: string[];
  values: number[][];
  totals: string[];
  format: (v: number) => string;
  color?: string;
  /** Fill this height (to sit level with a chart beside it); cells stretch, rows share it. */
  height?: number;
  /** Tooltip label for a cell; defaults to "row HH:00". */
  cellTip?: (row: number, hour: number) => string;
}) {
  const max = Math.max(1, ...values.flat());
  const [tip, setTip] = useState<string>('');
  return (
    <div className="fo-heat" data-fill={!!height} style={height ? { height } : undefined}>
      <div className="fo-heat-hours">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>{h % 6 === 0 ? `${String(h).padStart(2, '0')}:00` : ''}</span>
        ))}
        <span />
      </div>
      <div className="fo-heat-rows">
      {rows.map((r, i) => (
        <div key={r} className="fo-heat-row">
          <span className="fo-heat-label">{r}</span>
          {values[i].map((v, h) => {
            const f = v / max;
            return (
              <span
                key={h}
                className="fo-heat-cell"
                style={{ background: v > 0 ? `color-mix(in srgb, ${color} ${Math.round(12 + f * 88)}%, white)` : undefined }}
                onMouseEnter={() => setTip(v > 0 ? `${cellTip ? cellTip(i, h) : `${r} ${String(h).padStart(2, '0')}:00`} · ${format(v)}` : '')}
                onMouseLeave={() => setTip('')}
              />
            );
          })}
          <span className="fo-heat-total">{totals[i]}</span>
        </div>
      ))}
      </div>
      <div className="fo-heat-foot">
        <span className="fo-heat-legend">
          Less
          {[0.12, 0.4, 0.7, 1].map((f) => (
            <span key={f} className="fo-heat-cell" style={{ background: `color-mix(in srgb, ${color} ${f * 100}%, white)` }} />
          ))}
          More
        </span>
        <span className="fo-heat-tip">{tip}</span>
      </div>
    </div>
  );
}

/** A labelled share bar row (apps, projects, windows). */
export function ShareRow({
  label,
  sub,
  value,
  max,
  color,
  right,
  extra,
  selected,
  expanded,
  nested,
  onClick,
}: {
  label: ReactNode;
  sub?: ReactNode;
  value: number;
  max: number;
  color: string;
  right: ReactNode;
  extra?: ReactNode;
  selected?: boolean;
  /** Set on a row that opens and closes the rows under it. */
  expanded?: boolean;
  /** A row inside an opened group. */
  nested?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="fo-share-top">
        <span className="fo-share-label">{label}</span>
        {extra}
        <span className="fo-share-right">{right}</span>
      </div>
      <div className="fo-share-track">
        <span style={{ width: `${max ? Math.max(0.6, (value / max) * 100) : 0}%`, background: color }} />
      </div>
      {sub && <div className="fo-share-sub">{sub}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="fo-share"
      data-selected={selected}
      onClick={onClick}
      {...(expanded === undefined ? { 'aria-pressed': selected } : { 'aria-expanded': expanded })}
    >
      {body}
    </button>
  ) : (
    <div className="fo-share" data-nested={nested || undefined}>
      {body}
    </div>
  );
}

/** Seven tiny bars (one per day) — the shape of a week at a glance. */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className="fo-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(v > 0 ? 12 : 4, (v / max) * 100)}%`, background: v > 0 ? color : 'var(--n-150)' }} />
      ))}
    </span>
  );
}

/** Proportional ring, for a project split. */
export function Donut({ segs, size = 148, center }: { segs: Seg[]; size?: number; center?: ReactNode }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  const r = 15.9155;
  let acc = 0;
  // Rounded ends need room: a round cap adds half the stroke on each side, so long arcs leave a wider gap.
  const round = segs.filter((x) => x.value > 0).length > 1;
  const gapOf = (pct: number) => (!round ? 0 : pct > 6 ? 8 : 1.2);
  return (
    <div className="fo-donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" width={size} height={size}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--n-50)" strokeWidth="6" />
        {total > 0 &&
          segs.map((s) => {
            const pct = (s.value / total) * 100;
            const el = (
              <circle
                key={s.key}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="6"
                strokeLinecap={round && pct > 6 ? 'round' : 'butt'}
                strokeDasharray={`${Math.max(0.01, pct - gapOf(pct))} ${100 - Math.max(0.01, pct - gapOf(pct))}`}
                strokeDashoffset={25 - acc - gapOf(pct) / 2}
              />
            );
            acc += pct;
            return el;
          })}
      </svg>
      {center && <div className="fo-donut-center">{center}</div>}
    </div>
  );
}

/** One horizontal bar split into proportional, rounded pieces, with a legend under it. */
export function ProportionBar({ segs, format }: { segs: Seg[]; format: (v: number) => string }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  const shown = segs.filter((s) => s.value > 0);
  if (!total) return null;
  return (
    <div className="fo-prop">
      <div className="fo-prop-bar" role="img" aria-label="Split by project">
        {shown.map((s) => (
          <span
            key={s.key}
            title={`${s.label} · ${format(s.value)} · ${Math.round((s.value / total) * 100)}%`}
            style={{ flexGrow: s.value, ['--c' as string]: s.color }}
          />
        ))}
      </div>
      <div className="fo-prop-legend">
        {shown.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
            <b>{format(s.value)}</b>
            <small>{Math.round((s.value / total) * 100)}%</small>
          </span>
        ))}
      </div>
    </div>
  );
}
