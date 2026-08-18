import { NextResponse } from 'next/server';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { loadOpp, listQuotationFiles } from '@/lib/risansi-quotation-files';

export const runtime = 'nodejs';

// GET: the quotation documents for an opportunity, metadata only — the bytes
// are served one at a time from /quotation/<fileId>, so listing a quote with a
// dozen attachments stays a few hundred bytes instead of dragging blobs along.
//
// A static segment, so it never collides with the sibling /quotation/[fileId]
// route: Next resolves `files` literally before trying the dynamic match.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = await loadOpp(oppId);
  if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Reading the list is a view, gated like viewing the PDF itself.
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ files: await listQuotationFiles(oppId) });
}
