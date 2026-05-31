import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag, StatusDot } from '@/components/risansi';
import { AddClientDrawer } from '@/components/risansi/AddClientDrawer';
import risansiPool from '@/lib/db-risansi';
import { getCurrentFY, formatRevLakh } from '@/lib/risansi-utils';
// getCurrentFY kept for potential FY label use
import { FilterBar } from './FilterBar';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Constants ─────────────────────────────────────────────────

const PAGE_SIZE = 50;

// Whitelist of sortable columns
const SORT_MAP: Record<string, string> = {
  code:       'c.code',
  name:       'c.legal_name',
  industry:   'c.industry',
  zone:       'c.zone',
  last_visit: 'c.last_visit_date',
  status:     'c.status',
  tier:       'c.tier',
};

// ── Page ──────────────────────────────────────────────────────

export default async function ClientListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  const q_str    = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const indFilt  = typeof sp.industry === 'string' ? sp.industry.trim() : '';
  const zoneFilt = typeof sp.zone     === 'string' ? sp.zone.trim()     : '';
  const tierFilt = typeof sp.tier     === 'string' ? sp.tier.trim()     : '';
  // Status stored uppercase in DB; accept any case from URL and normalise
  const statFilt = typeof sp.status   === 'string' ? sp.status.trim().toUpperCase() : '';
  // 'sugar' param: '' | 'true' | 'false'  (maps to is_sugar boolean column)
  const sugarFilt = typeof sp.sugar   === 'string' ? sp.sugar.trim()   : '';
  // Default: sort by last visit date ascending so never-visited appear first.
  const sortKey  = typeof sp.sort     === 'string' ? sp.sort            : 'last_visit';
  const orderDir = sp.order === 'desc'             ? 'DESC'             : 'ASC';
  const pageNum  = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset   = (pageNum - 1) * PAGE_SIZE;

  const sortCol  = SORT_MAP[sortKey] ?? 'c.last_visit_date';
  const fy       = getCurrentFY();

  // ── Build parameterized WHERE conditions ───────────────────

  const conds: string[] = [];
  const vals:  (string | number)[] = [];
  let idx = 1;

  if (q_str) {
    conds.push(`(c.legal_name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR c.code ILIKE $${idx} OR c.city ILIKE $${idx} OR c.state ILIKE $${idx})`);
    vals.push(`%${q_str}%`); idx++;
  }
  if (indFilt) {
    conds.push(`c.industry = $${idx}`);
    vals.push(indFilt); idx++;
  }
  if (zoneFilt) {
    // Check both the client's own zone column and the assigned rep's zone
    conds.push(`(c.zone = $${idx} OR r.zone = $${idx})`);
    vals.push(zoneFilt); idx++;
  }
  if (tierFilt) {
    conds.push(`c.tier = $${idx}`);
    vals.push(tierFilt); idx++;
  }
  if (statFilt) {
    // DB stores uppercase (ACTIVE, INACTIVE …); URL value already uppercased above
    conds.push(`UPPER(c.status) = $${idx}`);
    vals.push(statFilt); idx++;
  }
  if (sugarFilt === 'true') {
    conds.push(`c.is_sugar = TRUE`);
  } else if (sugarFilt === 'false') {
    conds.push(`(c.is_sugar = FALSE OR c.is_sugar IS NULL)`);
  }

  const baseWhere = `c.deleted_at IS NULL`;
  const where = conds.length
    ? `WHERE ${baseWhere} AND ${conds.join(' AND ')}`
    : `WHERE ${baseWhere}`;

  // ── Queries ────────────────────────────────────────────────

  interface ClientRow {
    id:                  string;
    code:                string;
    legal_name:          string;
    trade_name:          string | null;
    industry:            string;
    zone:                string;
    tour_name:           string | null;
    status:              string;
    tier:                string | null;
    business_category:   string | null;
    ril_pcp_count:       number | null;
    total_others_pcp:    number | null;
    performance_feedback: string | null;
    last_visit_fy:       string | null;
    last_visit_date:     Date | null;
    action_points:       string | null;
    rep_name:            string | null;
    ytd_inr:             string;
  }

  const [clients, total, industries, zones, tiers] = await Promise.all([
    q<ClientRow[]>(async () => {
      const mainVals: (string | number)[] = [...vals, PAGE_SIZE, offset];
      const limIdx = idx;
      const offIdx = idx + 1;
      const { rows } = await risansiPool.query<ClientRow>(
        `SELECT
           c.id, c.code, c.legal_name, c.trade_name,
           c.industry, c.zone, c.tour_name, c.status, c.tier,
           c.business_category, c.ril_pcp_count, c.total_others_pcp,
           c.performance_feedback, c.last_visit_fy, c.last_visit_date,
           LEFT(c.action_points, 80) AS action_points,
           (COALESCE(c.rev_2526_pump,0) + COALESCE(c.rev_2526_spare,0))::text AS ytd_inr,
           COALESCE(r.name, c.primary_rep_name, '—') AS rep_name
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         ${where}
         ORDER BY ${sortCol} ${orderDir} ${orderDir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}
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
        `SELECT DISTINCT COALESCE(r.zone, c.zone) AS zone
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE COALESCE(r.zone, c.zone) IS NOT NULL AND c.deleted_at IS NULL
         ORDER BY 1`,
        [],
      );
      return rows.map(r => r.zone);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ tier: string }>(
        `SELECT DISTINCT tier FROM clients WHERE tier IS NOT NULL AND deleted_at IS NULL ORDER BY tier`,
        [],
      );
      return rows.map(r => r.tier);
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
    if (q_str)     base.q        = q_str;
    if (indFilt)   base.industry = indFilt;
    if (zoneFilt)  base.zone     = zoneFilt;
    if (tierFilt)  base.tier     = tierFilt;
    if (statFilt)  base.status   = statFilt;
    if (sugarFilt) base.sugar    = sugarFilt;
    if (sortKey)   base.sort     = sortKey;
    if (orderDir === 'DESC') base.order = 'desc';
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
    // Currently ASC on this col → go DESC. Otherwise → go ASC (default).
    const newOrder = (sortKey === col && orderDir === 'ASC') ? 'desc' : undefined;
    return buildUrl({ sort: col, order: newOrder, page: 1 });
  }

  function sortIndicator(col: string) {
    if (sortKey !== col) return null;
    return <span style={{ fontSize: 9, marginLeft: 3 }}>{orderDir === 'ASC' ? '▲' : '▼'}</span>;
  }

  // ── Status helpers ─────────────────────────────────────────

  function statusDotKind(s: string): 'active' | 'inactive' | 'prospect' {
    const su = s.toUpperCase();
    if (su === 'ACTIVE')      return 'active';
    if (su === 'INACTIVE')    return 'inactive';
    if (su === 'PROSPECTIVE') return 'prospect';
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
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Clients
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Client master · {total.toLocaleString('en-IN')} records
            </div>
          </div>
          <AddClientDrawer />
        </div>

        {/* ── Filter bar ──────────────────────────────────────── */}
        <FilterBar
          industries={industries}
          zones={zones}
          tiers={tiers}
          q={q_str}
          industry={indFilt}
          zone={zoneFilt}
          tier={tierFilt}
          status={statFilt}
          sugar={sugarFilt}
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
                      { label: 'Code',         key: 'code'         },
                      { label: 'Client',       key: 'name'         },
                      { label: 'Category',     key: 'category'     },
                      { label: 'Industry',     key: 'industry'     },
                      { label: 'Zone / Route', key: 'zone'         },
                      { label: 'Rep',          key: 'rep'          },
                      { label: 'Last Visit',   key: 'last_visit'   },
                      { label: 'Last FY',      key: 'last_fy'      },
                      { label: 'PCP (RIL/Tot)', key: 'pcp'         },
                      { label: 'Feedback',     key: 'feedback'     },
                      { label: 'YTD Rev',      key: 'ytd'          },
                      { label: 'Action Points', key: 'action_points'},
                      { label: 'Status',       key: 'status'       },
                      { label: 'Tier',         key: 'tier'         },
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
                    const daysColor = days == null ? 'var(--neg)' : days > 200 ? 'var(--neg)' : days > 100 ? 'var(--warn)' : 'var(--pos)';

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        {/* Code */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.code}
                        </td>
                        {/* Client name */}
                        <td style={{ ...TD, minWidth: 180 }}>
                          <Link
                            href={`/risansi/clients/${c.code}`}
                            style={{ fontWeight: 500, fontSize: 12, color: 'var(--fg)', textDecoration: 'none' }}
                          >
                            {c.legal_name}
                          </Link>
                          {c.trade_name && c.trade_name !== c.legal_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.trade_name}</div>
                          )}
                        </td>
                        {/* Business Category */}
                        <td style={TD}>
                          {c.business_category
                            ? <Tag kind={c.business_category === 'Sugar' ? 'accent' : undefined}>{c.business_category}</Tag>
                            : null}
                        </td>
                        {/* Industry */}
                        <td style={TD}><Tag>{c.industry}</Tag></td>
                        {/* Zone / Route */}
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone}</div>
                          {c.tour_name && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.tour_name}</div>}
                        </td>
                        {/* Rep */}
                        <td style={{ ...TD, fontSize: 12, color: 'var(--fg-3)' }}>{c.rep_name ?? '—'}</td>
                        {/* Last Visit */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: daysColor, whiteSpace: 'nowrap' }}>
                          {days == null ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
                        </td>
                        {/* Last Visit FY */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.last_visit_fy ? `FY ${c.last_visit_fy}` : '—'}
                        </td>
                        {/* PCP share */}
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {(c.ril_pcp_count ?? 0) > 0 || (c.total_others_pcp ?? 0) > 0
                            ? <span style={{ color: (c.ril_pcp_count ?? 0) > 0 ? 'var(--pos)' : 'var(--fg-3)' }}>
                                {c.ril_pcp_count ?? '0'}/{(c.ril_pcp_count ?? 0) + (c.total_others_pcp ?? 0)}
                              </span>
                            : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        {/* Performance feedback */}
                        <td style={TD}>
                          {c.performance_feedback
                            ? <Tag kind={
                                c.performance_feedback.toLowerCase().includes('good') ? 'pos'
                                : c.performance_feedback.toLowerCase().includes('poor') ? 'neg'
                                : 'warn'
                              }>{c.performance_feedback}</Tag>
                            : null}
                        </td>
                        {/* YTD Revenue */}
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {Number(c.ytd_inr) > 0 ? formatRevLakh(c.ytd_inr) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        {/* Action points (truncated) */}
                        <td style={{ ...TD, fontSize: 11, color: 'var(--fg-2)', maxWidth: 180 }}>
                          {c.action_points
                            ? <span title={c.action_points}>{c.action_points}{c.action_points.length >= 30 ? '…' : ''}</span>
                            : null}
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
