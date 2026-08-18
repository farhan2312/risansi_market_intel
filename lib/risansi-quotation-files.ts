import risansiPool from '@/lib/db-risansi';
import {
  canViewClient, hasRole, getManagerAssignableReps, type CurrentUser,
} from '@/lib/risansi-auth';

// Shared by the three quotation-attachment routes: the collection
// (/quotation), the metadata list (/quotation/files) and a single document
// (/quotation/[fileId]). They all answer the same two questions — may this user
// touch this opportunity, and is this really a PDF — so the answers live in one
// place rather than being re-typed (and eventually diverging) three times.

export interface QuotationFileRow {
  id: number;
  file_name: string;
  mime: string;
  size: number | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export interface OppRef {
  rep_id: number | null;
  client_id: number | null;
  stage: string;
}

export async function loadOpp(oppId: number): Promise<OppRef | null> {
  const { rows } = await risansiPool.query<OppRef>(
    'SELECT rep_id, client_id, stage FROM opportunities WHERE id = $1', [oppId],
  );
  return rows[0] ?? null;
}

// Mirror of userCanEditOpp in app/actions/risansi.ts — tour-based: admin always,
// or anyone who can see the client (a rep/manager on its tour, special-access).
export async function canEditOpp(
  user: CurrentUser, oppRepId: number | null, clientId: number | null,
): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  if (user.id != null && oppRepId != null && Number(oppRepId) === Number(user.id)) return true;
  if (clientId != null) return canViewClient(user, Number(clientId));
  if (user.role === 'manager' && user.id != null && oppRepId != null) {
    return (await getManagerAssignableReps(user.id)).includes(Number(oppRepId));
  }
  return false;
}

// Oldest first, so "the primary document" is a stable idea: whichever file was
// attached first stays first no matter how many are added later. That is what
// keeps every quotation_link already stored in the database — and every link
// already exported to Excel or mailed to a client — pointing at the same PDF.
export async function listQuotationFiles(oppId: number): Promise<QuotationFileRow[]> {
  const { rows } = await risansiPool.query<QuotationFileRow>(
    `SELECT id, file_name, mime, size, uploaded_at::text AS uploaded_at, uploaded_by_name
       FROM opportunity_quotation_files
      WHERE opportunity_id = $1
      ORDER BY uploaded_at, id`,
    [oppId],
  );
  return rows;
}

// A real PDF, verified three ways: claimed mime AND filename AND the %PDF-
// magic bytes. Checking mime OR extension would let an .html/.svg renamed
// x.pdf through, to be stored with its real (script-bearing) mime and later
// served inline — stored XSS in every colleague's browser.
export function pdfRejectionReason(bytes: Buffer, fileName: string, mime: string): string | null {
  const looksPdf = /pdf/i.test(mime) && /\.pdf$/i.test(fileName)
    && bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  return looksPdf ? null : 'Please upload a valid PDF file.';
}

// quotation_link points at the collection endpoint, which streams the primary
// document. Call after any change to the file set: it re-points the link when
// documents exist and clears it when the last one goes — but never overwrites a
// legacy EXTERNAL url with null, because that url is the only record of where
// that quote lives.
export async function syncQuotationLink(oppId: number): Promise<string | null> {
  const link = `/api/risansi/opportunities/${oppId}/quotation`;
  const { rows } = await risansiPool.query<{ n: string }>(
    'SELECT count(*) AS n FROM opportunity_quotation_files WHERE opportunity_id = $1', [oppId],
  );
  if (Number(rows[0]?.n ?? 0) > 0) {
    await risansiPool.query('UPDATE opportunities SET quotation_link = $1 WHERE id = $2', [link, oppId]);
    return link;
  }
  await risansiPool.query(
    "UPDATE opportunities SET quotation_link = NULL WHERE id = $1 AND quotation_link LIKE '/api/%'",
    [oppId],
  );
  // Report what actually survived rather than assuming null. Removing the last
  // uploaded document leaves a legacy external url untouched, and the quotation
  // form posts this value straight back in a hidden field — returning null there
  // would make the next save erase the only record of where that quote lives.
  const { rows: after } = await risansiPool.query<{ quotation_link: string | null }>(
    'SELECT quotation_link FROM opportunities WHERE id = $1', [oppId],
  );
  return after[0]?.quotation_link ?? null;
}
