import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole, getManagerAssignableReps } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

const VALID = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { stage } = await req.json();

  if (!VALID.includes(stage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
  }

  // Ownership — assigned rep, their tour manager, or admin/sysadmin only.
  const oppRes = await risansiPool.query<{ rep_id: number | null }>(
    'SELECT rep_id FROM opportunities WHERE id = $1', [id],
  );
  if (!oppRes.rows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const oppRepId = oppRes.rows[0].rep_id;
  const role  = session.user.role;
  const repId = session.user.repId;
  let allowed = hasRole(role, 'admin');
  if (!allowed && repId != null && oppRepId != null && Number(oppRepId) === Number(repId)) {
    allowed = true;
  }
  if (!allowed && role === 'manager' && repId != null && oppRepId != null) {
    const assignable = await getManagerAssignableReps(repId);
    allowed = assignable.includes(Number(oppRepId));
  }
  if (!allowed) {
    return NextResponse.json(
      { error: 'You do not have permission to move this opportunity.' },
      { status: 403 },
    );
  }

  try {
    await risansiPool.query(
      `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2`,
      [stage, id],
    );
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Drag-and-drop on Opportunities board', $3)`,
        [id, stage, session.user.email],
      );
    } catch { /* log table optional */ }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Stage update error:', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
