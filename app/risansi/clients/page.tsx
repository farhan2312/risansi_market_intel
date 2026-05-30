import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag, StatusDot } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY, fmtCr } from '@/lib/risansi-utils';
import { FilterBar } from './FilterBar';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Constants ─────────────────────────────────────────────────

const PAGE_SIZE = 50;

// Whitelist of sortable columns (outer query aliases)
const SORT_MAP: Record<string, string> = {
  code:       'client_code',
  name:       'legal_name',
  industry:   'industry',
  zone:       'zone',
  rep:        'rep_name',
  last_visit: 'last_visit_date',
  ytd:        'ytd_revenue',
  pipeline:   'pipeline_value',
  status:     'status',
  tier:       'tier',
};

// ── Page ──────────────────────────────────────────────────────

export default async function ClientListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  const q_str   = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const indFilt = typeof sp.industry === 'string' ? sp.industry.trim() : '';
  const zoneFilt = typeof sp.zone    === 'string' ? sp.zone.trim()     : '';
  const tierFilt = typeof sp.tier    === 'string' ? sp.tier.trim()     : '';
  const statFilt = typeof sp.status  === 'string' ? sp.status.trim()   : '';
  const sortKey  = typeof sp.sort    === 'string' ? sp.sort            : 'ytd';
  const orderDir = sp.order === 'asc'             ? 'ASC'              : 'DESC';
  const pageNum  = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset   = (pageNum - 1) * PAGE_SIZE;

  const sortCol  = SORT_MAP[sortKey] ?? 'ytd_revenue';
  const fy       = getCurrentFY();

  // ── Build parameterized WHERE conditions ───────────────────

  const conds: string[] = [];
  const vals:  (string | number)[] = [];
  let idx = 1;

  if (q_str) {
    conds.push(`(c.legal_name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR c.client_code ILIKE $${idx})`);
    vals.push(`%${q_str}%`); idx++;
  }
  if (indFilt) {
    conds.push(`c.industry = $${idx}`);
    vals.push(indFilt); idx++;
  }
  if (zoneFilt) {
    conds.push(`c.zone = $${idx}`);
    vals.push(zoneFilt); idx++;
  }
  if (tierFilt) {
    conds.push(`c.tier = $${idx}`);
    vals.push(tierFilt); idx++;
  }
  if (statFilt) {
    conds.push(`c.status = $${idx}`);
    vals.push(statFilt); idx++;
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // ── Queries ────────────────────────────────────────────────

  interface ClientRow {
    id:              string;
    client_code:     string;
    legal_name:      string;
    trade_name:      string | null;
    industry:        string;
    zone:            string;
    route:           string | null;
    status:          string;
    tier:            string | null;
    rep_name:        string | null;
    last_visit_date: Date | null;
    ytd_revenue:     string;
    pipeline_value:  string;
  }

  const fyCode = fy.code; // '25-26' — known constant, safe to embed

  const [clients, total, industries, zones] = await Promise.all([
    q<ClientRow[]>(async () => {
      const mainVals: (string | number)[] = [...vals, PAGE_SIZE, offset];
      const limIdx = idx;
      const offIdx = idx + 1;
      const { rows } = await risansiPool.query<ClientRow>(
        `SELECT
           c.id, c.client_code, c.legal_name, c.trade_name,
           c.industry, c.zone, c.route, c.status, c.tier,
           u.name AS rep_name,
           MAX(CASE WHEN v.status IN ('completed','checked-in') THEN v.visit_date ELSE NULL END)
             AS last_visit_date,
           COALESCE(SUM(CASE WHEN o.financial_year = '${fyCode}' THEN o.order_value ELSE 0 END), 0)::text
             AS ytd_revenue,
           COALESCE(SUM(CASE WHEN po.stage NOT IN ('Won','Lost') THEN po.estimated_value ELSE 0 END), 0)::text
             AS pipeline_value
         FROM clients c
         LEFT JOIN users u ON u.id = c.rep_id
         LEFT JOIN orders o ON o.client_id = c.id
         LEFT JOIN visits v ON v.client_id = c.id
         LEFT JOIN pipeline_opportunities po ON po.client_id = c.id
         ${where}
         GROUP BY c.id, c.client_code, c.legal_name, c.trade_name,
                  c.industry, c.zone, c.route, c.status, c.tier, u.name
         ORDER BY ${sortCol} ${orderDir} NULLS LAST
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        mainVals,
      );
      return rows;
    }, []),

    q<number>(async () => {
      const { rows } = await risansiPool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT c.id)::text AS total FROM clients c ${where}`,
        vals,
      );
      return Number(rows[0]?.total ?? 0);
    }, 0),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string }>(
        `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL ORDER BY industry`,
        [],
      );
      return rows.map(r => r.industry);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ zone: string }>(
        `SELECT DISTINCT zone FROM clients WHERE zone IS NOT NULL ORDER BY zone`,
        [],
      );
      return rows.map(r => r.zone);
    }, []),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const today      = Date.now();

  // ── Helpers ────────────────────────────────────────────────

  function daysAgo(d: Date | null): number | null {
    if (!d) return null;
    return Math.floor((today - new Date(d).getTime()) / 86_400_000);
  }

  function buildUrl(overrides: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = {};
    if (q_str)   base.q        = q_str;
    if (indFilt) base.industry = indFilt;
    if (zoneFilt) base.zone    = zoneFilt;
    if (tierFilt) base.tier    = tierFilt;
    if (statFilt) base.status  = statFilt;
    if (sortKey)  base.sort    = sortKey;
    if (orderDir === 'ASC') base.order = 'asc';
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v == null ? undefined : String(v)])
    )};
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== '') p.set(k, v);
    }
    return `/risansi/clients?${p.toString()}`;
  }

  function sortUrl(col: string): string {
    const newOrder = (sortKey === col && orderDir === 'DESC') ? 'asc' : undefined;
    return buildUrl({ sort: col, order: newOrder, page: 1 });
  }

  function sortIndicator(col: string) {
    if (sortKey !== col) return null;
    return <span style={{ fontSize: 9, marginLeft: 3 }}>{orderDir === 'DESC' ? '▼' : '▲'}</span>;
  }

  // ── Status helpers ─────────────────────────────────────────

  function statusDotKind(s: string): 'active' | 'inactive' | 'prospect' {
    if (s === 'Active')     return 'active';
    if (s === 'Inactive')   return 'inactive';
    if (s === 'Prospective') return 'prospect';
    return 'inactive';
  }

  function tierKind(t: string | null): 'accent' | undefined {
    return t === 'Key' ? 'accent' : undefined;
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Clients']} primaryAction="New Client" />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ─────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Clients
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Client master · {total.toLocaleString('en-IN')} records
          </div>
        </div>

        {/* ── Filter bar ──────────────────────────────────────── */}
        <FilterBar
          industries={industries}
          zones={zones}
          q={q_str}
          industry={indFilt}
          zone={zoneFilt}
          tier={tierFilt}
          status={statFilt}
          total={total}
        />

        {/* ── Table ───────────────────────────────────────────── */}
        <div style={{
          background: 'var(--bg-paper)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          marginTop: 2,
        }}>
          {clients.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
              No clients match the current filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {[
                      { label: 'Code',       key: 'code'       },
                      { label: 'Client',     key: 'name'       },
                      { label: 'Industry',   key: 'industry'   },
                      { label: 'Zone / Route', key: 'zone'     },
                      { label: 'Rep',        key: 'rep'        },
                      { label: 'Last Visit', key: 'last_visit' },
                      { label: 'YTD Rev',    key: 'ytd'        },
                      { label: 'Pipeline',   key: 'pipeline'   },
                      { label: 'Status',     key: 'status'     },
                      { label: 'Tier',       key: 'tier'       },
                    ].map(col => (
                      <th key={col.key} style={TH}>
                        <a href={sortUrl(col.key)} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}>
                          {col.label}{sortIndicator(col.key)}
                        </a>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const days = daysAgo(c.last_visit_date);
                    const daysColor = days == null ? 'var(--fg-3)' : days > 90 ? 'var(--neg)' : 'var(--fg-2)';
                    const ytd = Number(c.ytd_revenue);
                    const pipeline = Number(c.pipeline_value);

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        {/* Code */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.client_code}
                        </td>
                        {/* Client name */}
                        <td style={{ ...TD, minWidth: 180 }}>
                          <Link
                            href={`/risansi/clients/${c.id}`}
                            style={{ fontWeight: 500, fontSize: 12, color: 'var(--fg)', textDecoration: 'none' }}
                          >
                            {c.legal_name}
                          </Link>
                          {c.trade_name && c.trade_name !== c.legal_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.trade_name}</div>
                          )}
                        </td>
                        {/* Industry */}
                        <td style={TD}><Tag>{c.industry}</Tag></td>
                        {/* Zone / Route */}
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone}</div>
                          {c.route && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.route}</div>}
                        </td>
                        {/* Rep */}
                        <td style={{ ...TD, fontSize: 12, color: 'var(--fg-3)' }}>{c.rep_name ?? '—'}</td>
                        {/* Last Visit */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: daysColor, whiteSpace: 'nowrap' }}>
                          {days == null ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
                        </td>
                        {/* YTD Revenue */}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {ytd > 0 ? fmtCr(ytd) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        {/* Pipeline */}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {pipeline > 0 ? fmtCr(pipeline) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        {/* Status */}
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StatusDot s={statusDotKind(c.status)} />
                            <span style={{ fontSize: 11 }}>{c.status}</span>
                          </div>
                        </td>
                        {/* Tier */}
                        <td style={TD}>
                          {c.tier ? <Tag kind={tierKind(c.tier)}>{c.tier}</Tag> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Pagination ──────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && (
                <a href={buildUrl({ page: pageNum - 1 })} style={PAGE_BTN}>← Prev</a>
              )}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                // Show pages around current
                let p = i + 1;
                if (totalPages > 7) {
                  const start = Math.max(1, Math.min(pageNum - 3, totalPages - 6));
                  p = start + i;
                }
                return (
                  <a
                    key={p}
                    href={buildUrl({ page: p })}
                    style={{ ...PAGE_BTN, ...(p === pageNum ? PAGE_ACTIVE : {}) }}
                  >
                    {p}
                  </a>
                );
              })}
              {pageNum < totalPages && (
                <a href={buildUrl({ page: pageNum + 1 })} style={PAGE_BTN}>Next →</a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    500,
  color:         'var(--fg-3)',
  borderBottom:  '1px solid var(--line)',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

const PAGE_BTN: CSSProperties = {
  display:       'inline-flex',
  alignItems:    'center',
  justifyContent: 'center',
  minWidth:      30,
  height:        28,
  padding:       '0 8px',
  fontSize:      12,
  fontFamily:    'var(--font-mono)',
  background:    'var(--bg-paper)',
  border:        '1px solid var(--line-strong)',
  borderRadius:  5,
  color:         'var(--fg)',
  textDecoration: 'none',
  cursor:        'pointer',
};

const PAGE_ACTIVE: CSSProperties = {
  background: 'var(--accent)',
  color:      '#fff',
  border:     '1px solid var(--accent)',
  fontWeight: 500,
};
