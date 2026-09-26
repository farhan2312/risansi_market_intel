import Link from 'next/link';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql, hasRole } from '@/lib/risansi-auth';
import { NewComplaintForm, type ClientOpt } from '@/components/risansi/complaints/NewComplaintForm';
import type { UserOpt, OemOpt } from '@/components/risansi/complaints/ComplaintPageForm';

export const dynamic = 'force-dynamic';

// Raise a complaint. The clients offered are the ones the viewer may raise
// for: their own for a rep or manager, every live client for an admin or the
// Complaint Team. `?client=ID` preselects, from Client 360 and visit reports.

export default async function NewComplaintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const me = await getCurrentUser();
  const preselect = typeof sp.client === 'string' && /^\d+$/.test(sp.client) ? Number(sp.client) : null;

  const all = hasRole(me.role, 'admin') || me.departments.includes('Complaint Team');
  const cVis = all ? null : clientVisibilitySql(me, 'c');

  const [{ rows: clients }, { rows: users }, { rows: lookupRows }, { rows: oems }] = await Promise.all([
    risansiPool.query<ClientOpt>(`
      SELECT c.id::int AS id, c.code, c.legal_name AS name
        FROM clients c
       WHERE c.deleted_at IS NULL ${cVis ? `AND (${cVis})` : ''}
       ORDER BY c.legal_name`),
    risansiPool.query<UserOpt>(`
      SELECT u.id, u.name, u.role,
             ARRAY(SELECT d.department FROM user_departments d WHERE d.user_id = u.id ORDER BY 1) AS departments
        FROM users u WHERE u.is_active ORDER BY u.name`),
    risansiPool.query<{ kind: string; value: string }>('SELECT kind, value FROM complaint_lookups WHERE is_active ORDER BY kind, sort_order, value'),
    // Every OEM on the client master, for "supply came through an OEM".
    risansiPool.query<OemOpt>(`
      SELECT id, legal_name AS name, code
        FROM clients WHERE client_type = 'OEM' AND deleted_at IS NULL ORDER BY legal_name`),
  ]);
  const lookups: Record<string, string[]> = {};
  for (const r of lookupRows) (lookups[r.kind] ??= []).push(r.value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Complaints', href: '/risansi/complaints' }, 'Raise']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 1080 }}>
          <Link href="/risansi/complaints" style={{ fontSize: 11.5, color: 'var(--fg-3)', textDecoration: 'none' }}>← Complaints</Link>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '5px 0 3px' }}>Raise a complaint</h1>
          <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '0 0 16px', maxWidth: 720, lineHeight: 1.5 }}>
            Registration goes to the Complaint Team, who take it from Open through investigation, action and closure. The complaint gets a number and a page of its own the moment it is saved.
          </p>
          {clients.length ? (
            <NewComplaintForm clients={clients} preselect={preselect} lookups={lookups} users={users} oems={oems} />
          ) : (
            <div style={{ padding: '18px 20px', background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--fg-2)' }}>
              You have no clients to raise a complaint for. Ask an admin to assign the client to you, or ask the Complaint Team to register it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
