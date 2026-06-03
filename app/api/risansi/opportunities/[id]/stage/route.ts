import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
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
