import {
  runOverdueActionReminders,
  runOverdueComplaintReminders,
  runAdminOverdueEscalation,
} from '@/lib/risansi-notify';

// Daily reminder sweep, run by Vercel Cron (see vercel.json, 08:00 IST).
// Security: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
// set — we require it. Until it's set the route stays open so cron works out of
// the box; set CRON_SECRET in the project env to lock it down.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  const actionReminders    = await runOverdueActionReminders();
  const complaintReminders = await runOverdueComplaintReminders();
  const adminEscalations   = await runAdminOverdueEscalation();

  return Response.json({ ok: true, actionReminders, complaintReminders, adminEscalations });
}
