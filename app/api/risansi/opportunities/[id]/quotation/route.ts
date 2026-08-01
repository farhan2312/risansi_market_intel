import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import {
  getCurrentUser, canViewClient, hasRole, getManagerAssignableReps, type CurrentUser,
} from '@/lib/risansi-auth';
import { parseQuotationText } from '@/lib/risansi-quotation-parser';

// unpdf (and its bundled pdf.js) needs the Node runtime, not edge.
export const runtime = 'nodejs';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// Mirror of userCanEditOpp in app/actions/risansi.ts — tour-based: admin always,
// or anyone who can see the client (a rep/manager on its tour, special-access).
async function canEditOpp(user: CurrentUser, oppRepId: number | null, clientId: number | null): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  if (user.id != null && oppRepId != null && Number(oppRepId) === Number(user.id)) return true;
  if (clientId != null) return canViewClient(user, Number(clientId));
  if (user.role === 'manager' && user.id != null && oppRepId != null) {
    return (await getManagerAssignableReps(user.id)).includes(Number(oppRepId));
  }
  return false;
}

// POST: store the uploaded quotation PDF and return best-effort parsed fields.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = (await risansiPool.query<{ rep_id: number | null; stage: string; client_id: number | null }>(
    'SELECT rep_id, stage, client_id FROM opportunities WHERE id = $1', [oppId],
  )).rows[0];
  if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!(await canEditOpp(user, opp.rep_id, opp.client_id))) {
    return NextResponse.json({ error: 'You do not have permission to edit this opportunity.' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  const fileName = (file instanceof File && file.name) ? file.name : 'quotation.pdf';
  const mime = file.type || 'application/pdf';
  if (!/pdf/i.test(mime) && !/\.pdf$/i.test(fileName)) {
    return NextResponse.json({ error: 'Please upload a PDF file.' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Parse best-effort — never let extraction failure block storing the file.
  let parsed: ReturnType<typeof parseQuotationText> = { meta: {}, items: [] };
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    parsed = parseQuotationText(Array.isArray(text) ? text.join('\n') : text);
  } catch {
    // Scanned / unreadable PDF — store it, return empty fields.
  }

  await risansiPool.query(
    `INSERT INTO opportunity_quotation_files (opportunity_id, file_name, mime, size, bytes, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (opportunity_id) DO UPDATE
       SET file_name = EXCLUDED.file_name, mime = EXCLUDED.mime, size = EXCLUDED.size,
           bytes = EXCLUDED.bytes, uploaded_at = now()`,
    [oppId, fileName, mime, file.size, bytes],
  );
  const link = `/api/risansi/opportunities/${oppId}/quotation`;
  await risansiPool.query('UPDATE opportunities SET quotation_link = $1 WHERE id = $2', [link, oppId]);

  return NextResponse.json({ ok: true, fileName, size: file.size, link, meta: parsed.meta, items: parsed.items });
}

// DELETE: remove the stored quotation PDF (edit-gated). Clears quotation_link
// so the opportunity no longer points at a missing file.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = (await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
    'SELECT rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  )).rows[0];
  if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!(await canEditOpp(user, opp.rep_id, opp.client_id))) {
    return NextResponse.json({ error: 'You do not have permission to edit this opportunity.' }, { status: 403 });
  }

  await risansiPool.query('DELETE FROM opportunity_quotation_files WHERE opportunity_id = $1', [oppId]);
  await risansiPool.query('UPDATE opportunities SET quotation_link = NULL WHERE id = $1', [oppId]);
  return NextResponse.json({ ok: true });
}

// GET: stream the stored quotation PDF (inline) to viewers of the client.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  const opp = (await risansiPool.query<{ client_id: number | null }>(
    'SELECT client_id FROM opportunities WHERE id = $1', [oppId],
  )).rows[0];
  if (!opp) return new NextResponse('Not found', { status: 404 });
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rec = (await risansiPool.query<{ file_name: string; mime: string; bytes: Buffer }>(
    'SELECT file_name, mime, bytes FROM opportunity_quotation_files WHERE opportunity_id = $1', [oppId],
  )).rows[0];
  if (!rec) return new NextResponse('No file', { status: 404 });

  const body = new Uint8Array(rec.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': rec.mime || 'application/pdf',
      'Content-Disposition': `inline; filename="${rec.file_name.replace(/["\r\n]/g, '')}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
