import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { DrillCell } from './ExecDrilldown';
import { StackedHBars, GroupedBars, Donut, HBars, fmtCr } from './ExecCharts';
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
export interface ExecTable {
  headers: string[]; rows: Row[]; moneyFrom: number;
  /** Per value column: a colour for the header and the figures (undefined = plain). */
  colors?: (string | undefined)[];
  /** Per value column: what the column counts, as the header's tooltip. */
  notes?: (string | undefined)[];
}
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

export function MiniTable({ title, note, table, full, chart }: { title: string; note?: string; table: ExecTable; full?: boolean; chart?: ReactNode }) {
  const { headers, rows, moneyFrom, colors = [], notes = [] } = table;
  return (
    <div style={{ ...PANEL, ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>{title}</span>
        {note && <span style={META}>{note}</span>}
      </div>
      {/* The picture first, the figures under it: the chart says the shape,
          the table keeps the exact numbers and the drill-through on each. */}
      {chart && <div style={{ padding: '14px 14px 6px' }}>{chart}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>{headers.map((h, i) => {
              const c = i > 0 ? colors[i - 1] : undefined;
              return (
                <th key={h} title={i > 0 ? notes[i - 1] : undefined} style={{ ...TH, textAlign: i === 0 ? 'left' : 'right', color: c ?? TH.color }}>
                  {c && <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 5, verticalAlign: 'middle' }} />}{h}
                </th>
              );
            })}</tr>
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
                    <td key={vi} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: r.strong ? 700 : 400,
                                          color: v == null || v === 0 ? 'var(--fg-3)' : colors[vi] ?? 'var(--fg)',
                                          background: colors[vi] && v ? `color-mix(in oklab, ${colors[vi]} ${r.strong ? 14 : 8}%, transparent)` : undefined,
                                          borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>
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

// ── Tabs ───────────────────────────────────────────────────────
// Three views of the same review: the person, the account, the forecast.
// Plain links, so a tab is a URL somebody can be sent.
export type ExecTab = 'tsm' | 'account' | 'projection';
export const EXEC_TABS: { key: ExecTab; label: string; hint: string }[] = [
  { key: 'tsm',        label: 'TSM Review',       hint: 'One rep or manager: their book, quotes, turnover, visits' },
  { key: 'account',    label: 'Account Review',   hint: 'A group of mills or a single OEM across the years' },
  { key: 'projection', label: 'Sales Projection', hint: 'Expected closures by rep, month and quarter' },
];
export function ExecTabs({ active, hrefFor }: { active: ExecTab; hrefFor: (t: ExecTab) => string }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', marginBottom: 16, overflowX: 'auto' }}>
      {EXEC_TABS.map(t => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={hrefFor(t.key)} title={t.hint} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: on ? 600 : 500, textDecoration: 'none', whiteSpace: 'nowrap',
            color: on ? 'var(--accent)' : 'var(--fg-3)', borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
          }}>{t.label}</Link>
        );
      })}
    </div>
  );
}

export function ExecutiveViews({ data, selector, periodLabel, note, tabs }: {
  data: ExecData; selector: ReactNode; periodLabel: string; note?: string; tabs?: ReactNode;
}) {
  // The pictures over the tables. Each is built from the same rows the table
  // shows, so the two cannot disagree; Grand Total rows are left out.
  const body = (t: ExecTable) => t.rows.filter(r => !r.strong);
  const clientRows = body(data.clientsSummary).map(r => ({ label: r.label, parts: [r.vals[0] ?? 0, r.vals[1] ?? 0, r.vals[2] ?? 0] }));
  const quoteCats = body(data.quotationSummary).map(r => ({ label: r.label, values: [r.vals[0] ?? 0, r.vals[1] ?? 0] }));
  const turnCats = body(data.turnoverSummary).map(r => ({ label: r.label, values: [r.vals[1] ?? 0, r.vals[2] ?? 0] }));
  const turnClients = body(data.turnoverSummary).map(r => ({ label: r.label, value: r.vals[0] ?? 0 }));
  const offerSlices = body(data.offerStatus).map(r => ({ label: r.label, value: r.vals[0] ?? 0 }));
  const attCats = body(data.attendance).map(r => ({ label: r.label, values: [r.vals[0] ?? 0, r.vals[1] ?? 0] }));
  const [h1, h2] = [data.turnoverSummary.headers[2] ?? 'This FY', data.turnoverSummary.headers[3] ?? 'Last FY'];
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>{periodLabel}</div>
        </div>
        {selector}
      </div>
      {tabs}
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
        <MiniTable title="Clients Summary" note="clients by type and status" table={data.clientsSummary}
          chart={<StackedHBars rows={clientRows} series={['Active', 'Prospective', 'Inactive']} colors={['var(--pos)', 'var(--warn)', 'var(--neg)']} />} />
        <MiniTable title="Quotation Summary" note="₹ by channel" table={data.quotationSummary}
          chart={<GroupedBars cats={quoteCats} series={['Active quotes', 'Order received']} colors={['var(--accent)', 'var(--pos)']} fmt={fmtCr} />} />
        <MiniTable title="Turnover Summary" note="rows: 5-yr band · cols: whole fiscal years" table={data.turnoverSummary} full
          chart={
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
              <div><div style={CHART_T}>Turnover by band, {h1} vs {h2}</div><GroupedBars cats={turnCats} series={[h1, h2]} colors={['var(--accent)', 'var(--fg-3)']} fmt={fmtCr} height={110} /></div>
              <div><div style={CHART_T}>Clients in each band</div><HBars rows={turnClients} color="var(--pos)" highlightMax /></div>
            </div>
          } />
        <MiniTable title="Offer Status" note="₹ by opportunity status" table={data.offerStatus}
          chart={<Donut slices={offerSlices} colors={['var(--accent)', 'var(--warn)', 'var(--neg)', 'var(--pos)', 'var(--fg-3)']} fmt={fmtCr} />} />
        <MiniTable title="Attendance" note="field visits" table={data.attendance}
          chart={<GroupedBars cats={attCats} series={['Visit days', 'Clients']} colors={['var(--accent)', 'var(--pos)']} height={100} />} />
      </div>
    </section>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const CHART_T: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 };
const METRIC_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const TH: CSSProperties = { padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'var(--fg-3)', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
