import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { isBugSeverity } from '@/lib/risansi-bugs';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB screenshot cap
// Raster images only. SVG is deliberately excluded: it can carry <script>, and
// the screenshot is later served same-origin — an SVG would be a stored-XSS vector.
const ALLOWED_IMAGE = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
const MAX_DESC = 5000;
const MAX_PAGE = 500;

// POST — any signed-in user files a bug. Optional screenshot stored as bytea.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const title       = String(form.get('title') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const pageUrl     = String(form.get('page_url') ?? '').trim();
  const severityRaw = String(form.get('severity') ?? 'medium').trim();
  const severity    = isBugSeverity(severityRaw) ? severityRaw : 'medium';

  if (!title) return NextResponse.json({ error: 'Please add a short title.' }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: 'Title is too long (max 200 chars).' }, { status: 400 });
  if (description.length > MAX_DESC) return NextResponse.json({ error: `Description is too long (max ${MAX_DESC} chars).` }, { status: 400 });
  if (pageUrl.length > MAX_PAGE) return NextResponse.json({ error: 'Page reference is too long.' }, { status: 400 });

  // Validate the screenshot up front, before creating the bug row.
  const file = form.get('screenshot');
  let shot: { name: string; mime: string; size: number; bytes: Buffer } | null = null;
  if (file instanceof Blob && file.size > 0) {
    const mime = (file.type || 'image/png').toLowerCase();
    if (!ALLOWED_IMAGE.test(mime)) {
      return NextResponse.json({ error: 'Screenshot must be a PNG, JPG, GIF, WebP or BMP image (SVG not allowed).' }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Screenshot is too large (max 8 MB).' }, { status: 413 });
    }
    const name = (file instanceof File && file.name) ? file.name : 'screenshot.png';
    shot = { name, mime, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) };
  }

  // Snapshot the reporter's display name so it survives a later user deletion.
  const u = (await risansiPool.query<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM users WHERE id = $1', [user.id],
  )).rows[0];
  const reporterName  = u?.name || user.email || 'Unknown';
  const reporterEmail = u?.email || user.email;

  const ins = await risansiPool.query<{ id: number }>(
    `INSERT INTO bugs (title, description, page_url, severity, reporter_id, reporter_name, reporter_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [title, description || null, pageUrl || null, severity, user.id, reporterName, reporterEmail],
  );
  const bugId = ins.rows[0].id;

  if (shot) {
    await risansiPool.query(
      `INSERT INTO bug_screenshots (bug_id, file_name, mime, size, bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [bugId, shot.name, shot.mime, shot.size, shot.bytes],
    );
  }

  return NextResponse.json({ ok: true, id: bugId });
}
