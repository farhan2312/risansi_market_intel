import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { fmtCr } from '@/lib/risansi-utils';
import {
  approveAccessRequest,
  rejectAccessRequest,
  revokeAccess,
} from '@/app/actions/risansi-admin';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const VALID_ADMIN = process.env.ADMIN_EMAIL ?? 'admin@risansi.com';

// ── Data shapes ────────────────────────────────────────────────

interface AccessRequest  { email: string; display_name: string; created_at: string; }
interface ApprovedUser   { email: string; display_name: string; status: string; created_at: string; }
interface ColdAccount    { id: string; legal_name: string; industry: string; zone: string; last_visit: string | null; }
interface NoContactClient { id: string; legal_name: string; industry: string; zone: string; }
interface NoOrderClient  { id: string; legal_name: string; industry: string; zone: string; }
interface StaleOpp       { id: string; legal_name: string; stage: string; value_cr: number; updated_at: string | null; }
interface ActivityEntry  { entity_type: string | null; entity_id: string | null; action: string; email: string; created_at: string; }

// ── Page ───────────────────────────────────────────────────────

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || session.user.email !== VALID_ADMIN) {
    redirect('/risansi');
  }

  // ── All queries in parallel ───────────────────────────────────
  const [
    pendingRequests,
    approvedUsers,
    coldAccounts,
    noContactClients,
    noOrderClients,
    staleOpps,
    activityLog,
  ] = await Promise.all([

    // 1. Pending access requests
    q<AccessRequest[]>(async () => {
      const { rows } = await risansiPool.query<{ email: string; display_name: string; created_at: string }>(
        `SELECT email, display_name, requested_at::text AS created_at
         FROM access_requests
         WHERE status = 'Pending'
         ORDER BY requested_at ASC`,
      );
      return rows;
    }, []),

    // 2. Approved users roster
    q<ApprovedUser[]>(async () => {
      const { rows } = await risansiPool.query<{ email: string; display_name: string; status: string; created_at: string }>(
        `SELECT email, display_name, status, requested_at::text AS created_at
         FROM access_requests
         WHERE status IN ('Approved', 'Revoked')
         ORDER BY requested_at DESC`,
      );
      return rows;
    }, []),

    // 3a. Cold accounts (no visit 180+ days)
    q<ColdAccount[]>(async () => {
      const { rows } = await risansiPool.query<{ id: string; legal_name: string; industry: string; zone: string; last_visit: string | null }>(
        `SELECT c.id::text, c.legal_name, c.industry, c.zone,
                MAX(v.visit_date)::text AS last_visit
         FROM clients c
         LEFT JOIN visits v ON v.client_id = c.id
         WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL
         GROUP BY c.id, c.legal_name, c.industry, c.zone
         HAVING MAX(v.visit_date) < NOW() - INTERVAL '180 days'
             OR MAX(v.visit_date) IS NULL
         ORDER BY last_visit ASC NULLS FIRST
         LIMIT 20`,
      );
      return rows;
    }, []),

    // 3b. Clients with no contacts
    q<NoContactClient[]>(async () => {
      const { rows } = await risansiPool.query<{ id: string; legal_name: string; industry: string; zone: string }>(
        `SELECT c.id::text, c.legal_name, c.industry, c.zone
         FROM clients c
         WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.client_id = c.id)
         ORDER BY c.legal_name
         LIMIT 20`,
      );
      return rows;
    }, []),

    // 3c. Clients with no orders
    q<NoOrderClient[]>(async () => {
      const { rows } = await risansiPool.query<{ id: string; legal_name: string; industry: string; zone: string }>(
        `SELECT c.id::text, c.legal_name, c.industry, c.zone
         FROM clients c
         WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id = c.id)
         ORDER BY c.legal_name
         LIMIT 20`,
      );
      return rows;
    }, []),

    // 3d. Stale pipeline opportunities (no update 60 days)
    q<StaleOpp[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; legal_name: string; stage: string;
        value_cr: string; updated_at: string | null;
      }>(
        `SELECT p.id::text, c.legal_name, p.stage,
                COALESCE(p.value_cr, 0)::text AS value_cr,
                p.updated_at::text
         FROM opportunities p
         JOIN clients c ON c.id = p.client_id
         WHERE p.stage NOT IN ('Won', 'Lost')
           AND (p.updated_at < NOW() - INTERVAL '60 days' OR p.updated_at IS NULL)
         ORDER BY p.updated_at ASC NULLS FIRST
         LIMIT 20`,
      );
      return rows.map(r => ({
        id:              r.id,
        legal_name:      r.legal_name,
        stage:           r.stage,
        value_cr: Number(r.value_cr),
        updated_at:      r.updated_at,
      }));
    }, []),

    // 4. Activity log (last 10)
    q<ActivityEntry[]>(async () => {
      const { rows } = await risansiPool.query<{
        entity_type: string | null; entity_id: string | null;
        action: string; email: string; created_at: string;
      }>(
        `SELECT entity_type, entity_id, action, email, created_at::text
         FROM risansi_activity_log
         ORDER BY created_at DESC
         LIMIT 10`,
      );
      return rows;
    }, []),
  ]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Admin Console']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Admin Console
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Access control · data quality · audit log
            </div>
          </div>
          {pendingRequests.length > 0 && (
            <div style={{
              padding: '5px 12px',
              background: 'var(--warn-soft)',
              border: '1px solid rgba(217,119,6,0.25)',
              borderRadius: 5, fontSize: 12,
              color: '#92400E', fontWeight: 500,
            }}>
              {pendingRequests.length} access request{pendingRequests.length !== 1 ? 's' : ''} pending
            </div>
          )}
        </div>

        {/* ── Access requests + User roster ───────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* Pending access requests */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Access Requests</span>
              {pendingRequests.length > 0 && (
                <Tag kind="warn">{pendingRequests.length} pending</Tag>
              )}
            </div>
            {pendingRequests.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>
                No pending requests
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['Name', 'Email', 'Requested', ''].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map(req => (
                    <tr key={req.email} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{req.display_name}</td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {req.email}
                      </td>
                      <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {req.created_at ? new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                      <td style={TD}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <form action={approveAccessRequest}>
                            <input type="hidden" name="email" value={req.email} />
                            <button type="submit" style={{
                              ...ACTION_BTN,
                              background: 'var(--pos)',
                              color: '#fff',
                            }}>
                              Approve
                            </button>
                          </form>
                          <form action={rejectAccessRequest}>
                            <input type="hidden" name="email" value={req.email} />
                            <button type="submit" style={{
                              ...ACTION_BTN,
                              background: 'transparent',
                              color: 'var(--neg)',
                              border: '1px solid rgba(220,38,38,0.30)',
                            }}>
                              Reject
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* User roster */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>User Roster</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {approvedUsers.filter(u => u.status === 'Approved').length} active
              </span>
            </div>
            {approvedUsers.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>
                No approved users
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    {['User', 'Status', ''].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {approvedUsers.map(u => (
                    <tr key={u.email} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500 }}>{u.display_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{u.email}</div>
                      </td>
                      <td style={TD}>
                        <Tag kind={u.status === 'Approved' ? 'pos' : 'neg'} dot>{u.status}</Tag>
                      </td>
                      <td style={TD}>
                        {u.status === 'Approved' && (
                          <form action={revokeAccess}>
                            <input type="hidden" name="email" value={u.email} />
                            <button type="submit" style={{
                              ...ACTION_BTN,
                              background: 'transparent',
                              color: 'var(--neg)',
                              border: '1px solid rgba(220,38,38,0.30)',
                            }}>
                              Revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Data Quality ─────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', marginBottom: 10, letterSpacing: '-0.01em' }}>
            Data Quality
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>

            {/* Cold accounts */}
            <DQPanel
              label="Cold Accounts"
              count={coldAccounts.length}
              sub="No visit in 180+ days"
              kind={coldAccounts.length > 5 ? 'neg' : coldAccounts.length > 0 ? 'warn' : 'pos'}
            >
              {coldAccounts.slice(0, 5).map(c => (
                <DQRow key={c.id} primary={c.legal_name} secondary={c.last_visit
                  ? `Last: ${new Date(c.last_visit).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}`
                  : 'Never visited'
                } />
              ))}
              {coldAccounts.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', padding: '6px 12px' }}>
                  +{coldAccounts.length - 5} more
                </div>
              )}
            </DQPanel>

            {/* No contacts */}
            <DQPanel
              label="No Contacts"
              count={noContactClients.length}
              sub="Active clients with no contact person"
              kind={noContactClients.length > 5 ? 'neg' : noContactClients.length > 0 ? 'warn' : 'pos'}
            >
              {noContactClients.slice(0, 5).map(c => (
                <DQRow key={c.id} primary={c.legal_name} secondary={`${c.industry} · ${c.zone}`} />
              ))}
              {noContactClients.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', padding: '6px 12px' }}>
                  +{noContactClients.length - 5} more
                </div>
              )}
            </DQPanel>

            {/* No orders ever */}
            <DQPanel
              label="No Orders"
              count={noOrderClients.length}
              sub="Active clients with zero orders"
              kind={noOrderClients.length > 5 ? 'neg' : noOrderClients.length > 0 ? 'warn' : 'pos'}
            >
              {noOrderClients.slice(0, 5).map(c => (
                <DQRow key={c.id} primary={c.legal_name} secondary={`${c.industry} · ${c.zone}`} />
              ))}
              {noOrderClients.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', padding: '6px 12px' }}>
                  +{noOrderClients.length - 5} more
                </div>
              )}
            </DQPanel>

            {/* Stale pipeline */}
            <DQPanel
              label="Stale Pipeline"
              count={staleOpps.length}
              sub="No activity in 60+ days"
              kind={staleOpps.length > 3 ? 'neg' : staleOpps.length > 0 ? 'warn' : 'pos'}
            >
              {staleOpps.slice(0, 5).map(opp => (
                <DQRow
                  key={opp.id}
                  primary={opp.legal_name}
                  secondary={`${opp.stage}${opp.value_cr > 0 ? ` · ${fmtCr(opp.value_cr)}` : ''}`}
                />
              ))}
              {staleOpps.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', padding: '6px 12px' }}>
                  +{staleOpps.length - 5} more
                </div>
              )}
            </DQPanel>

          </div>
        </div>

        {/* ── Activity log ─────────────────────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Activity Log</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>last 10 entries</span>
          </div>
          {activityLog.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>
              No activity recorded yet
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  {['Timestamp', 'Entity', 'Action', 'By'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activityLog.map((entry, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                      {entry.created_at
                        ? new Date(entry.created_at).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short',
                            hour: '2-digit', minute: '2-digit', hour12: false,
                          })
                        : '—'}
                    </td>
                    <td style={TD}>
                      {entry.entity_type && (
                        <Tag>{entry.entity_type}</Tag>
                      )}
                      {entry.entity_id && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                          {entry.entity_id.slice(0, 12)}{entry.entity_id.length > 12 ? '…' : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ ...TD, color: 'var(--fg-2)' }}>{entry.action}</td>
                    <td style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {entry.email}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

type DQKind = 'pos' | 'warn' | 'neg';

function DQPanel({ label, count, sub, kind, children }: {
  label: string; count: number; sub: string;
  kind: DQKind; children: React.ReactNode;
}) {
  const countColor: Record<DQKind, string> = {
    pos: 'var(--pos)',
    warn: 'oklch(0.42 0.14 65)',
    neg: 'var(--neg)',
  };
  return (
    <div style={PANEL}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' }}>{label}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 400,
            color: countColor[kind], lineHeight: 1,
          }}>
            {count}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>{sub}</div>
      </div>
      <div style={{ minHeight: 60 }}>
        {children}
      </div>
    </div>
  );
}

function DQRow({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 1,
      padding: '7px 12px', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {primary}
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
        {secondary}
      </div>
    </div>
  );
}

// ── Shared style constants ─────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 14px',
  borderBottom: '1px solid var(--line)',
  display:      'flex',
  alignItems:   'center',
  gap:          10,
};

const PANEL_TITLE: CSSProperties = {
  fontSize:      12,
  fontWeight:    500,
  letterSpacing: '-0.005em',
};

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

const ACTION_BTN: CSSProperties = {
  padding:     '4px 10px',
  fontSize:    11,
  fontFamily:  'inherit',
  fontWeight:  500,
  border:      'none',
  borderRadius: 4,
  cursor:      'pointer',
  whiteSpace:  'nowrap',
};
