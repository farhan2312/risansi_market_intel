import type { CSSProperties } from 'react';
import Link from 'next/link';
import { quartersOf, type Projection } from '@/lib/risansi-sales-projection';

// Expected closures by rep, across the fiscal year.
//
// The coverage band above the table is not a caveat tucked at the bottom. On
// this data only a small share of open pipeline value carries an expected-close
// month, so the periods add up to a fraction of what is actually in play. A
// reader who takes the quarter totals as the forecast would be wrong by the
// inverse of that share, and the number that tells them so has to arrive first.

const cr = (n: number) => (n / 1e7).toFixed(2);
const crShort = (n: number) => (n === 0 ? '—' : (n / 1e7).toFixed(2));

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
    + (m === 4 ? ` ${String(y).slice(2)}` : '');
};

export function SalesProjection({ d, mode, hrefFor }: {
  d: Projection;
  mode: 'monthly' | 'quarterly';
  /** Builds the link that switches mode, preserving the page's other params. */
  hrefFor: (mode: 'monthly' | 'quarterly') => string;
}) {
  const quarters = quartersOf(d.months);
  const periods = mode === 'monthly'
    ? d.months.map(m => ({ key: m, label: MONTH_LABEL(m), months: [m] }))
    : quarters.map(q => ({ key: q.label, label: q.label, months: q.months }));

  // Every column the table carries, in order. The three at the end are not
  // periods and are deliberately not summed into the fiscal-year column.
  const TAIL = [
    { key: 'overdue', label: 'Overdue', hint: 'expected month already past' },
    { key: 'later', label: 'Beyond FY', hint: 'expected after March' },
    { key: 'none', label: 'No date', hint: 'no expected month recorded' },
  ];

  const cellOf = (rep: Projection['reps'][number], keys: string[]) =>
    rep.cells.filter(c => keys.includes(c.bucket))
      .reduce((s, c) => ({ gross: s.gross + c.gross, count: s.count + c.count }), { gross: 0, count: 0 });

  const colTotal = (keys: string[]) =>
    d.reps.reduce((s, r) => s + cellOf(r, keys).gross, 0);

  const fyTotal = (rep: Projection['reps'][number]) =>
    cellOf(rep, d.months).gross;

  const c = d.coverage;
  const pct = c.share == null ? 0 : Math.round(c.share * 100);
  const weighted = d.reps.reduce((s, r) => s + r.cells.reduce((a, x) => a + x.weighted, 0), 0);
  const weightedBase = d.reps.reduce((s, r) => s + r.cells.reduce((a, x) => a + x.weightedBase, 0), 0);

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg)', margin: 0 }}>Sales Projection</h2>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
            Expected closures by rep · FY {String(d.fyStart).slice(2)}-{String(d.fyStart + 1).slice(2)} · open pipeline only
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden' }}>
          {(['quarterly', 'monthly'] as const).map(m => (
            <Link
              key={m} href={hrefFor(m)} aria-current={mode === m}
              style={{
                padding: '6px 14px', fontSize: 12.5, textDecoration: 'none',
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? 'var(--accent)' : 'var(--bg-paper)',
                color: mode === m ? '#fff' : 'var(--fg-2)',
              }}
            >{m === 'quarterly' ? 'Quarterly' : 'Monthly'}</Link>
          ))}
        </div>
      </div>

      {/* ── how much of the pipeline this table can actually place ── */}
      <div style={{
        display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
        padding: '11px 14px', marginBottom: 10,
        background: pct >= 60 ? 'var(--bg-elev)' : 'var(--warn-soft)',
        border: `1px solid ${pct >= 60 ? 'var(--line)' : 'var(--warn)'}`,
        borderRadius: 'var(--radius)',
      }}>
        <div>
          <div style={LBL}>Open pipeline</div>
          <div style={BIG}>₹{cr(c.openGross)} Cr</div>
          <div style={SUB}>{c.openCount.toLocaleString('en-IN')} opportunities</div>
        </div>
        <div>
          <div style={LBL}>Has an expected month</div>
          <div style={{ ...BIG, color: pct >= 60 ? 'var(--fg)' : 'var(--warn-strong, var(--warn))' }}>
            ₹{cr(c.datedGross)} Cr
          </div>
          <div style={SUB}>{pct}% of value · {c.datedCount} of {c.openCount} opportunities</div>
        </div>
        <div>
          <div style={LBL}>Weighted by probability</div>
          <div style={BIG}>₹{cr(weighted)} Cr</div>
          <div style={SUB}>
            {c.openGross > 0 ? Math.round((weightedBase / c.openGross) * 100) : 0}% of open value carries a probability
          </div>
        </div>
        {pct < 60 && (
          <div style={{ flex: '1 1 250px', minWidth: 220, fontSize: 11.5, color: 'var(--warn-strong, var(--warn))', lineHeight: 1.5 }}>
            <strong>The periods below are not the pipeline.</strong> {100 - pct}% of open value has no
            expected-close month, so it sits in <em>No date</em> and is projected into no quarter at all.
            Fill Expected Close on the opportunities to move it into the forecast.
          </div>
        )}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--bg-paper)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elev)' }}>
              <th style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-elev)', minWidth: 150 }}>Rep</th>
              {periods.map(p => <th key={p.key} style={TH}>{p.label}</th>)}
              <th style={{ ...TH, borderLeft: '2px solid var(--line-strong)' }}>FY total</th>
              {TAIL.map(t => <th key={t.key} style={TH} title={t.hint}>{t.label}</th>)}
              <th style={{ ...TH, borderLeft: '2px solid var(--line-strong)' }}>All open</th>
            </tr>
          </thead>
          <tbody>
            {d.reps.length === 0 && (
              <tr><td colSpan={periods.length + TAIL.length + 3} style={{ ...TD, textAlign: 'center', color: 'var(--fg-3)', padding: 24 }}>
                No open opportunities for the reps you can see.
              </td></tr>
            )}
            {d.reps.map(rep => {
              const undated = cellOf(rep, ['none']).gross;
              // A rep whose whole book is undated contributes nothing to any
              // period; the row would otherwise read as "no pipeline".
              const allUndated = rep.totalGross > 0 && undated === rep.totalGross;
              return (
                <tr key={rep.repId} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td style={{ ...TD, fontWeight: 500, position: 'sticky', left: 0, background: 'var(--bg-paper)' }}>
                    {rep.name}
                    {allUndated && (
                      <div style={{ fontSize: 9.5, color: 'var(--warn-strong, var(--warn))' }}>nothing dated</div>
                    )}
                  </td>
                  {periods.map(p => {
                    const v = cellOf(rep, p.months);
                    return (
                      <td key={p.key} style={NUM} title={v.count ? `${v.count} opportunit${v.count === 1 ? 'y' : 'ies'}` : undefined}>
                        {crShort(v.gross)}
                      </td>
                    );
                  })}
                  <td style={{ ...NUM, fontWeight: 700, borderLeft: '2px solid var(--line-strong)' }}>{crShort(fyTotal(rep))}</td>
                  {TAIL.map(t => {
                    const v = cellOf(rep, [t.key]);
                    return (
                      <td key={t.key} style={{ ...NUM, color: t.key === 'none' ? 'var(--warn-strong, var(--warn))' : 'var(--fg-3)' }}
                        title={v.count ? `${v.count} opportunit${v.count === 1 ? 'y' : 'ies'}` : undefined}>
                        {crShort(v.gross)}
                      </td>
                    );
                  })}
                  <td style={{ ...NUM, fontWeight: 700, borderLeft: '2px solid var(--line-strong)' }}>{crShort(rep.totalGross)}</td>
                </tr>
              );
            })}
          </tbody>
          {d.reps.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--bg-elev)', fontWeight: 700 }}>
                <td style={{ ...TD, position: 'sticky', left: 0, background: 'var(--bg-elev)' }}>All reps</td>
                {periods.map(p => <td key={p.key} style={NUM}>{crShort(colTotal(p.months))}</td>)}
                <td style={{ ...NUM, borderLeft: '2px solid var(--line-strong)' }}>{crShort(colTotal(d.months))}</td>
                {TAIL.map(t => (
                  <td key={t.key} style={{ ...NUM, color: t.key === 'none' ? 'var(--warn-strong, var(--warn))' : 'var(--fg-2)' }}>
                    {crShort(colTotal([t.key]))}
                  </td>
                ))}
                <td style={{ ...NUM, borderLeft: '2px solid var(--line-strong)' }}>
                  {crShort(d.reps.reduce((s, r) => s + r.totalGross, 0))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: '8px 0 0', maxWidth: 900, lineHeight: 1.55 }}>
        Figures are ₹ Crores, gross offer value, from the opportunity&apos;s Expected Close month.
        Open means every stage except Won, Lost and Dropped; a deal is credited to the rep on the
        opportunity. <strong>Overdue</strong> is an expected month that has already passed — it is still
        open, so it is still counted, just not in a future period. <strong>FY total</strong> covers April
        to March and deliberately excludes Overdue, Beyond FY and No date, which is why it is smaller
        than All open. Nothing here infers a date from anything else: an opportunity with no Expected
        Close stays in No date rather than being guessed into a quarter.
      </p>
    </section>
  );
}

const TH: CSSProperties = {
  padding: '8px 10px', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  fontWeight: 700, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap', textAlign: 'right',
};
const TD: CSSProperties = { padding: '7px 10px', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const LBL: CSSProperties = { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--fg-3)' };
const BIG: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginTop: 2 };
const SUB: CSSProperties = { fontSize: 10.5, color: 'var(--fg-3)', marginTop: 1 };
