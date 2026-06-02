import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag, StatusDot, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { formatRev } from '@/lib/risansi-utils';
import { FilterBar } from './FilterBar';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[clients/page]', err); return fallback; }
}

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
  rep:        'r.name',
  ytd:        'COALESCE(c.rev_2526_total, 0)',
};

export default async function ClientListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  const q_str     = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const sugarFilt = typeof sp.sugar    === 'string' ? sp.sugar.trim()    : '';
  const sortKey   = typeof sp.sort     === 'string' ? sp.sort            : 'last_visit';
  const orderDir  = sp.order === 'desc'             ? 'DESC'             : 'ASC';
  const pageNum   = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset    = (pageNum - 1) * PAGE_SIZE;

  // Multi-select filters — comma-separated in URL
  const indFilts    = typeof sp.industry === 'string' && sp.industry ? sp.industry.split(',').filter(Boolean) : [];
  const zoneFilts   = typeof sp.zone     === 'string' && sp.zone     ? sp.zone.split(',').filter(Boolean)     : [];
  const tierFilts   = typeof sp.tier     === 'string' && sp.tier     ? sp.tier.split(',').filter(Boolean)     : [];
  const statFilts   = typeof sp.status   === 'string' && sp.status   ? sp.status.split(',').filter(Boolean).map(s => s.toUpperCase()) : [];
  const repFilts    = typeof sp.rep      === 'string' && sp.rep      ? sp.rep.split(',').filter(Boolean)      : [];

  const sortCol  = SORT_MAP[sortKey] ?? 'c.last_visit_date';

  // ── Build parameterised WHERE conditions ──────────────────

  const conds: string[] = [];
  const vals:  (string | number | string[])[] = [];
  let idx = 1;

  if (q_str) {
    conds.push(`(c.legal_name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR c.code ILIKE $${idx} OR c.city ILIKE $${idx} OR c.state ILIKE $${idx})`);
    vals.push(`%${q_str}%`); idx++;
  }
  if (indFilts.length > 0) {
    conds.push(`c.industry = ANY($${idx}::text[])`);
    vals.push(indFilts); idx++;
  }
  if (zoneFilts.length > 0) {
    conds.push(`(c.zone = ANY($${idx}::text[]) OR r.zone = ANY($${idx}::text[]))`);
    vals.push(zoneFilts); idx++;
  }
  if (tierFilts.length > 0) {
    conds.push(`c.tier = ANY($${idx}::text[])`);
    vals.push(tierFilts); idx++;
  }
  if (statFilts.length > 0) {
    conds.push(`UPPER(c.status) = ANY($${idx}::text[])`);
    vals.push(statFilts); idx++;
  }
  if (repFilts.length > 0) {
    conds.push(`(c.primary_rep_name = ANY($${idx}::text[]) OR r.name = ANY($${idx}::text[]))`);
    vals.push(repFilts); idx++;
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
    id:                   string;
    code:                 string;
    legal_name:           string;
    trade_name:           string | null;
    industry:             string;
    zone:                 string;
    tour_name:            string | null;
    status:               string;
    tier:                 string | null;
    business_category:    string | null;
    performance_feedback: string | null;
    last_visit_fy:        string | null;
    last_visit_date:      Date | null;
    action_points:        string | null;
    rep_name:             string | null;
    rep_initials:         string | null;
    ytd_inr:              number;
    prev_inr:             number;
  }

  interface RepOption { rep_name: string; client_count: number; }
  const [clients, total, industries, zones, tiers, repOptions] = await Promise.all([
    q<ClientRow[]>(async () => {
      const mainVals: (string | number | string[])[] = [...vals, PAGE_SIZE, offset];
      const limIdx = idx;
      const offIdx = idx + 1;
      const { rows } = await risansiPool.query<ClientRow>(
        `SELECT
           c.id, c.code, c.legal_name, c.trade_name,
           c.industry, c.zone, c.tour_name, c.status, c.tier,
           c.business_category,
           c.performance_feedback, c.last_visit_fy, c.last_visit_date,
           LEFT(c.action_points, 80) AS action_points,
           COALESCE(c.rev_2526_total, 0)::bigint AS ytd_inr,
           COALESCE(r.name, c.primary_rep_name, '—') AS rep_name,
           COALESCE(r.initials,
             LEFT(COALESCE(c.primary_rep_name,''),1) ||
             COALESCE(LEFT(SPLIT_PART(COALESCE(c.primary_rep_name,''), ' ', 2), 1), '')
           ) AS rep_initials
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         ${where}
         ORDER BY ${sortCol} ${orderDir} ${orderDir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        mainVals as (string | number)[],
      );
      return rows;
    }, []),

    q<number>(async () => {
      const { rows } = await risansiPool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT c.id)::text AS total FROM clients c LEFT JOIN reps r ON c.primary_rep_id = r.id ${where}`,
        vals as (string | number)[],
      );
      return Number(rows[0]?.total ?? 0);
    }, 0),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ industry: string }>(
        `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL ORDER BY industry`,
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
      );
      return rows.map(r => r.zone);
    }, []),

    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ tier: string }>(
        `SELECT DISTINCT tier FROM clients WHERE tier IS NOT NULL AND deleted_at IS NULL ORDER BY tier`,
      );
      return rows.map(r => r.tier);
    }, []),

    q<RepOption[]>(async () => {
      const { rows } = await risansiPool.query<RepOption>(
        `SELECT
           COALESCE(r.name, c.primary_rep_name) AS rep_name,
           COUNT(*)::int AS client_count
         FROM clients c
         LEFT JOIN reps r ON c.primary_rep_id = r.id
         WHERE c.deleted_at IS NULL
           AND (c.primary_rep_name IS NOT NULL OR r.name IS NOT NULL)
         GROUP BY COALESCE(r.name, c.primary_rep_name)
         HAVING COALESCE(r.name, c.primary_rep_name) IS NOT NULL
         ORDER BY client_count DESC
         LIMIT 30`,
      );
      return rows;
    }, []),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const today      = Date.now();

  function daysAgo(d: Date | null): number | null {
    if (!d) return null;
    return Math.floor((today - new Date(d).getTime()) / 86_400_000);
  }

  function buildUrl(overrides: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = {};
    if (q_str)              base.q        = q_str;
    if (indFilts.length)    base.industry = indFilts.join(',');
    if (zoneFilts.length)   base.zone     = zoneFilts.join(',');
    if (tierFilts.length)   base.tier     = tierFilts.join(',');
    if (statFilts.length)   base.status   = statFilts.join(',');
    if (repFilts.length)    base.rep      = repFilts.join(',');
    if (sugarFilt)          base.sugar    = sugarFilt;
    if (sortKey)            base.sort     = sortKey;
    if (orderDir === 'DESC') base.order   = 'desc';
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

  function repColor(name: string): string {
    const colors = [
      '#0A3D8F','#1A5CB8','#2E7DD1','#00B4D8',
      '#0E9F6E','#D97706','#7C3AED','#DB2777',
      '#059669','#DC2626','#2563EB','#9333EA',
    ];
    if (!name || name === '—') return '#6B7FA3';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

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

  // Current sort for SortableTH
  const curSort = sortKey;
  const curDir  = orderDir === 'DESC' ? 'desc' : 'asc';

  // Status options for MultiSelectFilter
  const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'PROSPECTIVE', 'BLACKLISTED'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Clients']} />
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

        {/* ── Search + Sugar toggle row ────────────────────────── */}
        <FilterBar q={q_str} sugar={sugarFilt} total={total} />

        {/* ── Multi-select filter row ──────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 8 }}>
          <MultiSelectFilter param="industry" label="Industry"  options={industries}      selected={indFilts}  />
          <MultiSelectFilter param="zone"     label="Zone"      options={zones}           selected={zoneFilts} />
          <MultiSelectFilter param="tier"     label="Tier"      options={tiers}           selected={tierFilts} />
          <MultiSelectFilter param="status"   label="Status"    options={STATUS_OPTIONS}  selected={statFilts} />
          <MultiSelectFilter param="rep"      label="Rep"       options={repOptions.map(r => ({ value: r.rep_name, label: r.rep_name, count: r.client_count }))} selected={repFilts}  />
        </div>

        {/* ── Active filter pills ──────────────────────────────── */}
        <ActiveFilterBar filters={[
          { param: 'industry', label: 'Industry', values: indFilts  },
          { param: 'zone',     label: 'Zone',     values: zoneFilts },
          { param: 'tier',     label: 'Tier',     values: tierFilts },
          { param: 'status',   label: 'Status',   values: statFilts },
          { param: 'rep',      label: 'Rep',      values: repFilts  },
        ]} />

        {/* ── Table ───────────────────────────────────────────── */}
        <div style={{
          background:   'var(--bg-paper)',
          border:       '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow:     'hidden',
          marginTop:    8,
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
                    <SortableTH col="code"       label="Code"          currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="name"       label="Client"        currentSort={curSort} currentDir={curDir} />
                    <th style={TH}>Category</th>
                    <SortableTH col="industry"   label="Industry"      currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="zone"       label="Zone / Route"  currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="rep"        label="Rep"           currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="last_visit" label="Last Visit"    currentSort={curSort} currentDir={curDir} />
                    <th style={TH}>Last FY</th>
                    <th style={TH}>Feedback</th>
                    <SortableTH col="ytd"        label="YTD Rev"       currentSort={curSort} currentDir={curDir} align="right" />
                    <th style={TH}>Action Points</th>
                    <SortableTH col="status"     label="Status"        currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="tier"       label="Tier"          currentSort={curSort} currentDir={curDir} />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const days = daysAgo(c.last_visit_date);
                    const daysColor = days == null ? 'var(--neg)' : days > 200 ? 'var(--neg)' : days > 100 ? 'var(--warn)' : 'var(--pos)';

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.code}
                        </td>
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
                        <td style={TD}>
                          {c.business_category
                            ? <Tag kind={c.business_category === 'Sugar' ? 'accent' : undefined}>{c.business_category}</Tag>
                            : null}
                        </td>
                        <td style={TD}><Tag>{c.industry}</Tag></td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone}</div>
                          {c.tour_name && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.tour_name}</div>}
                        </td>
                        <td style={TD}>
                          <div
                            title={c.rep_name ?? '—'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 28, height: 28, borderRadius: 6,
                              background: repColor(c.rep_name ?? ''),
                              color: '#fff', fontSize: 11, fontWeight: 700,
                              cursor: 'default', fontFamily: 'var(--font-mono)',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {c.rep_initials || '—'}
                          </div>
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: daysColor, whiteSpace: 'nowrap' }}>
                          {days == null ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.last_visit_fy ? `FY ${c.last_visit_fy}` : '—'}
                        </td>
                        <td style={TD}>
                          {c.performance_feedback
                            ? <Tag kind={
                                c.performance_feedback.toLowerCase().includes('good') ? 'pos'
                                : c.performance_feedback.toLowerCase().includes('poor') ? 'neg'
                                : 'warn'
                              }>{c.performance_feedback}</Tag>
                            : null}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {c.ytd_inr > 0 ? formatRev(c.ytd_inr) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        <td style={{ ...TD, fontSize: 11, color: 'var(--fg-2)', maxWidth: 180 }}>
                          {c.action_points
                            ? <span title={c.action_points}>{c.action_points}{c.action_points.length >= 30 ? '…' : ''}</span>
                            : null}
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StatusDot s={statusDotKind(c.status)} />
                            <span style={{ fontSize: 11 }}>{c.status}</span>
                          </div>
                        </td>
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
                let p = i + 1;
                if (totalPages > 7) {
                  const start = Math.max(1, Math.min(pageNum - 3, totalPages - 6));
                  p = start + i;
                }
                return (
                  <a key={p} href={buildUrl({ page: p })}
                    style={{ ...PAGE_BTN, ...(p === pageNum ? PAGE_ACTIVE : {}) }}>
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
  background:    'var(--bg-elev)',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

const PAGE_BTN: CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  minWidth:       30,
  height:         28,
  padding:        '0 8px',
  fontSize:       12,
  fontFamily:     'var(--font-mono)',
  background:     'var(--bg-paper)',
  border:         '1px solid var(--line-strong)',
  borderRadius:   5,
  color:          'var(--fg)',
  textDecoration: 'none',
  cursor:         'pointer',
};

const PAGE_ACTIVE: CSSProperties = {
  background: 'var(--accent)',
  color:      '#fff',
  border:     '1px solid var(--accent)',
  fontWeight: 500,
};
