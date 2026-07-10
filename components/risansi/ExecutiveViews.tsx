import type { CSSProperties } from 'react';

// ────────────────────────────────────────────────────────────────
// Executive Views — the monthly-review dashboards used for each TSM.
//
// The figures below mirror the current Excel review sheets (Jul 2026) and are
// STATIC placeholders. To wire them to live data, replace the data constants in
// this file with query results (same shape) — the layout stays as-is. A detailed
// requirements walkthrough (Mona) will define the exact source mappings.
// ────────────────────────────────────────────────────────────────

type Row = { label: string; vals: (number | null)[]; strong?: boolean };

// ── Group A · existing sales team (sugar + non-sugar) ────────────

const clientsSummary = {
  headers: ['Client type', 'AV', 'MRK', 'Total'],
  moneyFrom: 99, // all counts
  rows: [
    { label: 'End User',      vals: [41, 34, 75] },
    { label: 'Group (Mills)', vals: [26, 13, 39] },
    { label: 'OEM',           vals: [null, 2, 2] },
    { label: 'Grand Total',   vals: [67, 49, 116], strong: true },
  ] as Row[],
};

const turnoverSummary = {
  headers: ['Turnover band', 'Clients', 'TO 25-26', 'TO 24-25', 'TO 23-24', 'TO 26-27 (May)'],
  moneyFrom: 1, // col 0 is a count, the rest are ₹
  rows: [
    { label: '1-3 Lacs p.a.',                 vals: [25, 7257353, 6272748, 5492408, 61774] },
    { label: '15 Lac & above (Super Critical)', vals: [6, 6457459, 17382173, 13097655, 27562] },
    { label: '3-5 Lacs p.a.',                 vals: [14, 4525308, 4979343, 6987743, null] },
    { label: '5-15 Lacs p.a.',                vals: [25, 21779660, 21698055, 22374358, 1149408] },
    { label: 'Business Regained',             vals: [1, null, null, null, null] },
    { label: 'End Client',                    vals: [1, null, null, null, null] },
    { label: 'Less than 1 Lac p.a.',          vals: [28, 1459320, 936564, 1386847, 208658] },
    { label: 'New Business',                  vals: [7, 1213619, null, null, 254000] },
    { label: 'No Business',                   vals: [9, null, null, null, null] },
    { label: 'Grand Total',                   vals: [116, 42692719, 51268883, 49339011, 1701402], strong: true },
  ] as Row[],
};

const quotationSummary = {
  headers: ['Channel', 'Active', 'Order Received', 'Total'],
  moneyFrom: 0,
  rows: [
    { label: 'Direct Mill', vals: [26973671, 8554674, 35528345] },
    { label: 'Group',       vals: [1710513, 842258, 2552771] },
    { label: 'OEM',         vals: [108135, null, 108135] },
    { label: 'Trader',      vals: [109518, null, 109518] },
    { label: 'Grand Total', vals: [28901837, 9396932, 38298769], strong: true },
  ] as Row[],
};

// ── Group B · new sales (leads focus) ───────────────────────────

const leadSummary = [
  { label: 'Total Leads',          value: 163 },
  { label: 'Converted to Enquiry', value: 32 },
  { label: 'Converted to Client',  value: 6 },
  { label: 'Visited',              value: 65 },
];

const totalBusinessInr = 2108224; // order booking

const offerStatus = {
  headers: ['Offer status', 'Total Offer Value (INR)'],
  moneyFrom: 0,
  rows: [
    { label: 'Active',            vals: [3725280] },
    { label: 'Hold · Active',     vals: [584200] },
    { label: 'Order Lost by RIL', vals: [154960] },
    { label: 'Order Received',    vals: [678240] },
    { label: 'Requirement Closed', vals: [24850] },
    { label: 'Grand Total',       vals: [5167530], strong: true },
  ] as Row[],
};

// ── Attendance (one block per person) ───────────────────────────

const attendance = {
  headers: ['Month', 'Visit days', 'Office days', 'Clients'],
  moneyFrom: 99,
  people: {
    VG: [
      { label: 'April', vals: [15, 15, 27] },
      { label: 'May',   vals: [17, 14, 23] },
      { label: 'June',  vals: [17, 13, 27] },
      { label: 'Total', vals: [49, 42, 77], strong: true },
    ] as Row[],
    Amit: [
      { label: 'April', vals: [10, 20, 16] },
      { label: 'May',   vals: [12, 19, 23] },
      { label: 'June',  vals: [14, 16, 23] },
      { label: 'Total', vals: [36, 55, 62], strong: true },
    ] as Row[],
  },
};

const inr = (n: number) => n.toLocaleString('en-IN');

// ── Building blocks ─────────────────────────────────────────────

function MiniTable({ title, note, headers, rows, moneyFrom, full }: {
  title: string; note?: string; headers: string[]; rows: Row[]; moneyFrom: number; full?: boolean;
}) {
  return (
    <div style={{ ...PANEL, ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>{title}</span>
        {note && <span style={META}>{note}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} style={{ ...TH, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: r.strong ? 'var(--bg-elev)' : 'transparent' }}>
                <td style={{ ...TD, fontWeight: r.strong ? 700 : 500, color: 'var(--fg)', borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>{r.label}</td>
                {r.vals.map((v, vi) => (
                  <td key={vi} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: r.strong ? 700 : 400, color: v == null ? 'var(--fg-3)' : 'var(--fg)', borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>
                    {v == null ? '—' : (vi >= moneyFrom ? '₹' : '') + inr(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', margin: '22px 0 10px' }}>{children}</div>;
}

// ── Section ─────────────────────────────────────────────────────

export function ExecutiveViews() {
  return (
    <section style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--fg)', margin: 0 }}>Executive Views</h2>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 999, background: 'var(--warn-soft)', color: 'var(--warn)', border: '1px solid var(--warn)' }}>
          Preview · sample data
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '5px 0 0', maxWidth: 760, lineHeight: 1.5 }}>
        Monthly-review dashboards for each TSM. Figures below mirror the current Excel review sheets — live data wiring
        follows the requirements walkthrough.
      </p>

      {/* ── Existing sales team · sugar + non-sugar ── */}
      <GroupLabel>Existing sales team · sugar &amp; non-sugar</GroupLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <MiniTable title="Clients Summary" note="by TSM" headers={clientsSummary.headers} rows={clientsSummary.rows} moneyFrom={clientsSummary.moneyFrom} />
        <MiniTable title="Quotation Summary" note="₹ by channel" headers={quotationSummary.headers} rows={quotationSummary.rows} moneyFrom={quotationSummary.moneyFrom} />
        <MiniTable title="Turnover Summary" note="till May 2026" headers={turnoverSummary.headers} rows={turnoverSummary.rows} moneyFrom={turnoverSummary.moneyFrom} full />
        <MiniTable title="Attendance · VG" headers={attendance.headers} rows={attendance.people.VG} moneyFrom={attendance.moneyFrom} />
      </div>

      {/* ── New sales · leads focus ── */}
      <GroupLabel>New sales · leads focus</GroupLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {/* Lead summary KPIs */}
        <div style={PANEL}>
          <div style={PANEL_H}><span style={PANEL_TITLE}>Lead Summary</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--line)' }}>
            {leadSummary.map(k => (
              <div key={k.label} style={{ background: 'var(--bg-paper)', padding: '13px 14px' }}>
                <div style={METRIC_LABEL}>{k.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: 'var(--fg)', lineHeight: 1.1, marginTop: 3 }}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Total business (order booking) */}
        <div style={{ ...PANEL, borderLeft: '4px solid var(--title)', display: 'flex', flexDirection: 'column' }}>
          <div style={PANEL_H}><span style={PANEL_TITLE}>Total Business</span><span style={META}>order booking</span></div>
          <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--fg)', lineHeight: 1.05 }}>₹{inr(totalBusinessInr)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>≈ ₹{(totalBusinessInr / 100000).toFixed(2)} L · booked this period</div>
          </div>
        </div>

        <MiniTable title="Offer Status" note="sum of offer value" headers={offerStatus.headers} rows={offerStatus.rows} moneyFrom={offerStatus.moneyFrom} full />
        <MiniTable title="Attendance · Amit" headers={attendance.headers} rows={attendance.people.Amit} moneyFrom={attendance.moneyFrom} />
      </div>
    </section>
  );
}

// ── Shared style constants (design system, dark-mode safe) ──────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const METRIC_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const TH: CSSProperties = { padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'var(--fg-3)', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
