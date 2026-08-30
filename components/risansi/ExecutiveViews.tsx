import type { CSSProperties, ReactNode } from 'react';
import { DrillCell } from './ExecDrilldown';
import type { DrillParams } from '@/app/actions/risansi-exec-drilldown';

// ────────────────────────────────────────────────────────────────
// Executive Review — the monthly per-TSM review dashboards, now driven by live
// data. The page (app/risansi/executive-review) computes the ExecData for the
// selected TSM + month and renders it here.
// ────────────────────────────────────────────────────────────────

// `drill` runs parallel to `vals`: one entry per column, null where that cell
// has nothing to itemise (a grand total, a zero). Every figure on this page is a
// sum or a count over a set of clients, and the set was the one thing the reader
// could not see.
export type Row = {
  label: string; vals: (number | null)[]; strong?: boolean;
  drill?: (DrillParams | null)[];
};
export interface ExecTable { headers: string[]; rows: Row[]; moneyFrom: number }
// A breakdown row inside a KPI card (e.g. "Visited (≤90d) · 42").
export interface ExecKpiLine { label: string; value: string; color?: string; drill?: DrillParams }
export interface ExecKpi {
  label: string; value: string; sub?: string; accent?: boolean;
  drill?: DrillParams;    // breakdown for the main number
  lines?: ExecKpiLine[];
}
export interface ExecData {
  clientsSummary:  ExecTable;
  turnoverSummary: ExecTable;
  quotationSummary: ExecTable;
  offerStatus:     ExecTable;
  attendance:      ExecTable;
  kpis:            ExecKpi[];
}

const inr = (n: number) => n.toLocaleString('en-IN');

export function MiniTable({ title, note, table, full }: { title: string; note?: string; table: ExecTable; full?: boolean }) {
  const { headers, rows, moneyFrom } = table;
  return (
    <div style={{ ...PANEL, ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>{title}</span>
        {note && <span style={META}>{note}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>{headers.map((h, i) => <th key={h} style={{ ...TH, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ ...TD, textAlign: 'center', color: 'var(--fg-3)', padding: '18px 0' }}>No data</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={ri} style={{ background: r.strong ? 'var(--bg-elev)' : 'transparent' }}>
                <td style={{ ...TD, fontWeight: r.strong ? 700 : 500, color: 'var(--fg)', borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>{r.label}</td>
                {r.vals.map((v, vi) => {
                  const text = v == null ? '—' : (vi >= moneyFrom ? '₹' : '') + inr(v);
                  const d = r.drill?.[vi];
                  return (
                    <td key={vi} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: r.strong ? 700 : 400, color: v == null ? 'var(--fg-3)' : 'var(--fg)', borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>
                      {d && v ? <DrillCell params={d}>{text}</DrillCell> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExecutiveViews({ data, selector, periodLabel, note }: {
  data: ExecData; selector: ReactNode; periodLabel: string; note?: string;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>{periodLabel}</div>
        </div>
        {selector}
      </div>
      {note && <p style={{ fontSize: 11.5, color: 'var(--fg-3)', margin: '8px 0 0', maxWidth: 900, lineHeight: 1.5 }}>{note}</p>}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.kpis.length}, 1fr)`, gap: 12, margin: '16px 0', alignItems: 'start' }}>
        {data.kpis.map(k => (
          <div key={k.label} style={{ ...PANEL, padding: '13px 15px', ...(k.accent ? { borderLeft: '4px solid var(--title)' } : {}) }}>
            <div style={METRIC_LABEL}>{k.label}</div>
            {k.drill ? (
              <div style={{ marginTop: 4 }}>
                <DrillCell params={k.drill}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', lineHeight: 1.1 }}>
                  {k.value}
                </DrillCell>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>{k.value}</div>
            )}
            {k.sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{k.sub}</div>}
            {k.lines && k.lines.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {k.lines.map(l => {
                  const row = (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
                      <span style={{ color: l.color ?? 'var(--fg-3)' }}>{l.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: l.color ?? 'var(--fg)' }}>{l.value}</span>
                    </div>
                  );
                  return l.drill
                    ? <DrillCell key={l.label} params={l.drill} style={{ display: 'block', width: '100%', textDecoration: 'none' }}>{row}</DrillCell>
                    : <div key={l.label}>{row}</div>;
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <MiniTable title="Clients Summary" note="active clients by type" table={data.clientsSummary} />
        <MiniTable title="Quotation Summary" note="₹ by channel" table={data.quotationSummary} />
        <MiniTable title="Turnover Summary" note="rows: 5-yr band · cols: selected month(s)" table={data.turnoverSummary} full />
        <MiniTable title="Offer Status" note="₹ by opportunity status" table={data.offerStatus} />
        <MiniTable title="Attendance" note="field visits" table={data.attendance} />
      </div>
    </section>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const METRIC_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const TH: CSSProperties = { padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'var(--fg-3)', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
