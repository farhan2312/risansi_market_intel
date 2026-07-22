import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

// GET — stream a bug's screenshot inline. The system admin (who works the queue)
// or the original reporter may view it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bugId = parseInt(id, 10);
  if (!Number.isInteger(bugId)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const bug = (await risansiPool.query<{ reporter_id: number | null }>(
    'SELECT reporter_id FROM bugs WHERE id = $1', [bugId],
  )).rows[0];
  if (!bug) return new NextResponse('Not found', { status: 404 });

  const isReporter = user.id != null && bug.reporter_id != null && Number(bug.reporter_id) === Number(user.id);
  if (!hasRole(user.role, 'sysadmin') && !isReporter) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rec = (await risansiPool.query<{ file_name: string; mime: string; bytes: Buffer }>(
    'SELECT file_name, mime, bytes FROM bug_screenshots WHERE bug_id = $1', [bugId],
  )).rows[0];
  if (!rec) return new NextResponse('No screenshot', { status: 404 });

  // Defence in depth: even though upload allows only raster images, never serve a
  // non-raster type inline (an SVG would execute script when opened top-level).
  // Anything unexpected is forced to a downloaded octet-stream. nosniff stops the
  // browser from re-interpreting the bytes as a different, executable type.
  const SAFE_RASTER = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
  const safe = SAFE_RASTER.test(rec.mime || '');
  const contentType = safe ? rec.mime : 'application/octet-stream';
  const disposition = safe ? 'inline' : 'attachment';

  const body = new Uint8Array(rec.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${rec.file_name.replace(/["\r\n]/g, '')}"`,
      'Content-Length': String(body.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
