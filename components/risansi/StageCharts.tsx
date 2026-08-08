// Chart primitives for the per-stage dashboards.
//
// Hand-rolled SVG/CSS, matching the rest of the app (Donut, ForecastBar,
// MiniBars) rather than pulling in a charting library for four shapes. All of
// them are server-renderable — no hooks, no client boundary — so a stage page
// stays one round trip.
//
// Every one of them takes a `total` or renders an explicit "no data" state,
// because several of these charts sit over columns that are mostly unfilled
// (lost_reason is set on 2 of 11 Lost; drop_reason on 0 of 16). Silently drawing
// an empty chart would read as "nothing lost to competitors" rather than
// "nobody recorded it".

import type { CSSProperties, ReactNode } from 'react';
import { CHART_COLORS } from '@/lib/risansi-stage-dashboard';

export interface Slice { label: string; count: number; value: number }

const fmtCrShort = (cr: number) => `₹${cr.toFixed(cr >= 10 ? 1 : 2)} Cr`;

// ── Panel wrapper ──────────────────────────────────────────────

export function ChartPanel({ title, sub, children, note }: {
  title: string; sub?: string; children: ReactNode; note?: string;
}) {
  return (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>
        {sub && <span style={{ fontSize: 10.5, color: 'var(--fg-3)', marginLeft: 'auto' }}>{sub}</span>}
      </div>
      <div style={{ padding: 14, flex: 1 }}>{children}</div>
      {note && (
        <div style={{ padding: '0 14px 11px', fontSize: 10.5, color: 'var(--fg-3)', fontStyle: 'italic' }}>{note}</div>
      )}
    </div>
  );
}

export function NoData({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: '22px 12px', textAlign: 'center', fontSize: 11.5, color: 'var(--fg-3)',
      background: 'var(--bg-sunk)', border: '1px dashed var(--line-strong)', borderRadius: 7,
    }}>
      {msg}
    </div>
  );
}

// ── Horizontal bar list ────────────────────────────────────────
// The workhorse: product mix, market split, top reps, top clients, lost reasons.
// Bars are scaled by VALUE but every row shows its count too, because "3 deals
// worth ₹18 Cr" and "180 deals worth ₹18 Cr" are different situations and a bar
// alone can't tell them apart.

export function BarList({ rows, metric = 'value', max: maxIn, emptyMsg }: {
  rows: Slice[];
  /** Which number sets the bar length. Counts suit "how many", value suits "how much". */
  metric?: 'value' | 'count';
  max?: number;
  emptyMsg?: string;
}) {
  if (!rows.length) return <NoData msg={emptyMsg ?? 'Nothing to show for this stage yet.'} />;
  const pick = (r: Slice) => (metric === 'count' ? r.count : r.value);
  const max = maxIn ?? Math.max(...rows.map(pick), 0.0001);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => {
        const pct = Math.max((pick(r) / max) * 100, 1.5);
        const hue = CHART_COLORS[i % CHART_COLORS.length];
        return (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{
              width: 118, flexShrink: 0, fontSize: 11, color: 'var(--fg-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, height: 16, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: `${hue}2E`, borderLeft: `3px solid ${hue}` }} />
            </div>
            <span style={{ width: 42, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {r.count}
            </span>
            <span style={{ width: 74, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
              {fmtCrShort(r.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Ageing columns ─────────────────────────────────────────────
// Vertical bars, because ageing is ordered and the eye should read left-to-right
// as "getting worse". The 90d+ column is tinted red on stages where age is a
// problem rather than a fact.

export function AgeingBars({ buckets, warnFrom = 2, height = 130 }: {
  buckets: Slice[];
  /** Index from which a bucket is coloured as a warning. */
  warnFrom?: number;
  height?: number;
}) {
  const max = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: height + 44 }}>
      {buckets.map((b, i) => {
        const h   = Math.max((b.count / max) * height, b.count > 0 ? 3 : 0);
        const hue = b.label === 'No date' ? 'var(--fg-3)' : i >= warnFrom ? 'var(--neg)' : 'var(--accent)';
        return (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{b.count}</span>
            <div style={{
              width: '100%', height: h, background: `color-mix(in oklab, ${hue} 22%, transparent)`,
              borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{b.label}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{fmtCrShort(b.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Single stacked bar ─────────────────────────────────────────
// For a two-or-three-part split of one total: SO covered vs awaiting,
// domestic vs export.

export function StackedBar({ parts, total }: {
  parts: { label: string; value: number; color: string; sub?: string }[];
  total?: number;
}) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  if (sum <= 0) return <NoData msg="No value recorded for this split yet." />;
  return (
    <div>
      <div style={{ display: 'flex', height: 26, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-sunk)' }}>
        {parts.map(p => p.value > 0 && (
          <div key={p.label} title={`${p.label} — ${fmtCrShort(p.value)}`}
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 11 }}>
        {parts.map(p => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{p.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{fmtCrShort(p.value)}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {Math.round((p.value / sum) * 100)}%{p.sub ? ` · ${p.sub}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Monthly trend ──────────────────────────────────────────────

export function TrendBars({ points, height = 120 }: {
  points: { label: string; count: number; value: number }[];
  height?: number;
}) {
  if (!points.length) return <NoData msg="No dated activity to trend yet." />;
  const max = Math.max(...points.map(p => p.value), 0.0001);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 40 }}>
      {points.map(p => {
        const h = Math.max((p.value / max) * height, p.value > 0 ? 3 : 0);
        return (
          <div key={p.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{p.count}</span>
            <div title={`${p.label} — ${p.count} · ${fmtCrShort(p.value)}`} style={{
              width: '100%', height: h, background: 'color-mix(in oklab, var(--pos) 22%, transparent)',
              borderTop: '3px solid var(--pos)', borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Offer movement ─────────────────────────────────────────────
// One row per deal: where the offer started, where it is now, and how far it
// moved. A paired bar rather than two separate charts, because the only
// interesting quantity is the gap between them.

export interface OfferMove {
  id: string; label: string; original: number | null; current: number | null; revisions: number;
}

export function OfferMovement({ rows }: { rows: OfferMove[] }) {
  const usable = rows.filter(r => r.original != null && r.current != null && r.original > 0);
  if (!usable.length) {
    return <NoData msg="No re-priced quotes in this stage yet. Add a revised offer on a quotation and the movement shows here." />;
  }
  const max = Math.max(...usable.flatMap(r => [r.original ?? 0, r.current ?? 0]), 1);
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {usable.map(r => {
        const o = r.original as number, c = r.current as number;
        const delta = ((c - o) / o) * 100;
        const up = delta > 0;
        return (
          <div key={r.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                {r.revisions} revision{r.revisions === 1 ? '' : 's'}
              </span>
              {Math.abs(delta) >= 0.05 && (
                <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: up ? 'var(--pos)' : 'var(--neg)' }}>
                  {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
            {([['Original', o, 'var(--fg-3)'], ['Current', c, up ? 'var(--pos)' : 'var(--neg)']] as const).map(([lbl, v, hue]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ width: 54, flexShrink: 0, fontSize: 10, color: 'var(--fg-3)' }}>{lbl}</span>
                <div style={{ flex: 1, height: 13, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max((v / max) * 100, 1)}%`, background: `color-mix(in oklab, ${hue} 30%, transparent)`, borderLeft: `2px solid ${hue}` }} />
                </div>
                <span style={{ width: 96, flexShrink: 0, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{inr(v)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── KPI tile ───────────────────────────────────────────────────

export function StageKpi({ label, value, sub, color, alert }: {
  label: string; value: string; sub?: string; color?: string;
  /** Draws attention: the tile is a to-do, not a fact. */
  alert?: boolean;
}) {
  return (
    <div style={{
      padding: '11px 13px', borderRadius: 8,
      background: alert ? 'var(--warn-soft, #FEF3C7)' : 'var(--bg-paper)',
      border: `1px solid ${alert ? 'var(--warn, #F59E0B)' : 'var(--line)'}`,
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 21, marginTop: 3, lineHeight: 1.1, color: color ?? 'var(--fg)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export const CHART_GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, marginBottom: 14,
};
