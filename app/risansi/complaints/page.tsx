import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, complaintVisibilitySql, clientVisibilitySql } from '@/lib/risansi-auth';
import { ComplaintsClient } from '@/components/risansi/ComplaintsClient';
import { type ComplaintRow } from '@/components/risansi/ComplaintDetail';
import { type ClientOpt, type UserOpt } from '@/components/risansi/ComplaintFormModal';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[complaints]', err); return fallback; }
}

export default async function ComplaintsPage() {
  const me = await getCurrentUser();
  const vis = complaintVisibilitySql(me, 'cm');
  const cVis = clientVisibilitySql(me, 'c');

  const [complaints, users, clients] = await Promise.all([
    q<ComplaintRow[]>(async () => {
      const { rows } = await risansiPool.query<ComplaintRow>(`
        SELECT cm.id, cm.complaint_no, cm.legacy_ref, cm.client_id, cm.client_code,
          cl.legal_name AS client_name, cm.channel, cm.complaint_date::text AS complaint_date,
          cm.details, cm.part_name, cm.quantity, cm.pump_model,
          cm.invoice_no, cm.invoice_date::text AS invoice_date,
          cm.client_po_no, cm.client_po_date::text AS client_po_date,
          cm.priority, cm.status, cm.due_date::text AS due_date,
          cm.assigned_to_user, au.name AS assigned_name, cm.assigned_to_external,
          cm.reported_by_raw, ru.name AS reported_name,
          cm.root_cause, cm.resolution, cm.created_by,
          cm.created_at::text AS created_at, cm.updated_at::text AS updated_at
        FROM complaints cm
        LEFT JOIN clients cl ON cl.id = cm.client_id
        LEFT JOIN users au ON au.id = cm.assigned_to_user
        LEFT JOIN users ru ON ru.id = cm.reported_by_user
        ${vis ? `WHERE ${vis}` : ''}
        ORDER BY
          CASE cm.status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'Awaiting Client' THEN 2 WHEN 'Resolved' THEN 3 ELSE 4 END,
          COALESCE(cm.complaint_date, cm.created_at::date) DESC, cm.id DESC
      `);
      return rows;
    }, []),

    q<UserOpt[]>(async () => (await risansiPool.query<UserOpt>(
      `SELECT id::int AS id, name, role FROM users WHERE is_active = TRUE ORDER BY name`)).rows, []),

    q<ClientOpt[]>(async () => (await risansiPool.query<ClientOpt>(`
      SELECT c.id::int AS id, c.code, c.legal_name AS name
        FROM clients c
       WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'
       ${cVis ? `AND (${cVis})` : ''}
       ORDER BY c.legal_name ASC`)).rows, []),
  ]);

  const active = complaints.filter(c => c.status !== 'Closed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Complaints']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Complaints</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {complaints.length} total · {active} active
          </div>
        </div>
        <ComplaintsClient
          complaints={complaints} users={users} clients={clients}
          me={{ id: me.id, email: me.email, role: me.role }} canCreate
        />
      </div>
    </div>
  );
}
