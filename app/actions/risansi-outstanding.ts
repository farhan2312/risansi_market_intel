'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// DEBTOR (sheet) code → users.id. AV / MRK / SV are personal initials (confident);
// NI / SI / VA are territory / ambiguous codes mapped on best judgment — worth a
// sanity check with the team. The raw code is stored too, so nothing is lost.
export const DEBTOR_USER: Record<string, number> = {
  AV:  5,   // Anil Vankudre
  MRK: 6,   // Madhav R Kulkarni
  SV:  9,   // Sudhir Vichare
  NI:  4,   // Amit Srivastava (North India)
  SI:  10,  // Guna Sekaran (South India)
  VA:  20,  // Vishal Gaikwad (best guess)
};

export interface OutstandingRow {
  client_code: string;
  debtor:      string;   // raw DEBTOR code from the sheet
  amount:      number;
}

export interface OutstandingUploadResult {
  matched:      number;
  skipped:      number;
  skippedCodes: string[];
  grandTotal:   number;
}

// Full-replace upload: every monthly sheet clears ALL prior outstanding and
// loads itself in one transaction. Amount → clients.total_outstanding; the
// snapshot as-of date + mapped owner + raw debtor code ride along per client.
export async function uploadOutstanding(
  rows: OutstandingRow[], asOfDate: string, filename: string,
): Promise<OutstandingUploadResult> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!hasRole(role, 'admin')) throw new Error('Unauthorized');
  const email = session!.user!.email!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('Invalid as-of date');

  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');

    // 1. Wipe the previous snapshot from every client.
    await c.query(
      `UPDATE clients
          SET total_outstanding = NULL, outstanding_as_of = NULL,
              outstanding_owner_id = NULL, outstanding_debtor_code = NULL
        WHERE total_outstanding IS NOT NULL
           OR outstanding_as_of IS NOT NULL
           OR outstanding_debtor_code IS NOT NULL`,
    );

    // 2. Apply the new sheet in ONE statement, matching on client code.
    //
    //    This used to be one UPDATE per row inside the loop, which is one network
    //    round trip per row against a Postgres in another region. 210 rows fitted
    //    inside the 10s cap vercel.json puts on app/**; 294 did not, and the
    //    upload failed with nothing on screen to say so. Measured on the same
    //    data: 294 serial updates 4529ms, this one statement 37ms.
    //
    //    Two sheet rows can carry the same client code. The loop let the last one
    //    win; a set-based UPDATE joined against both would pick one arbitrarily,
    //    so they are collapsed here first, keeping that same last-wins rule.
    const wanted = new Map<string, { amount: number; ownerId: number | null; debtor: string | null }>();
    for (const r of rows) {
      const code = (r.client_code ?? '').trim().toUpperCase();
      if (!code) continue;
      const debtor = (r.debtor ?? '').trim().toUpperCase();
      wanted.set(code, {
        amount:  Number(r.amount) || 0,
        ownerId: DEBTOR_USER[debtor] ?? null,
        debtor:  debtor || null,
      });
    }

    const codes   = [...wanted.keys()];
    const amounts = codes.map(k => wanted.get(k)!.amount);
    const owners  = codes.map(k => wanted.get(k)!.ownerId);
    const debtors = codes.map(k => wanted.get(k)!.debtor);

    const applied = codes.length
      ? await c.query<{ code: string; amount: string }>(
          `UPDATE clients cl
              SET total_outstanding       = v.amount,
                  outstanding_as_of       = $2::date,
                  outstanding_owner_id    = v.owner_id,
                  outstanding_debtor_code = v.debtor
             FROM (SELECT * FROM unnest($1::text[], $3::numeric[], $4::int[], $5::text[])
                     AS t(code, amount, owner_id, debtor)) v
            WHERE UPPER(cl.code) = v.code AND cl.deleted_at IS NULL
        RETURNING v.code AS code, v.amount::text AS amount`,
          [codes, asOfDate, amounts, owners, debtors],
        )
      : { rows: [] as { code: string; amount: string }[] };

    const hit        = new Set(applied.rows.map(r => r.code));
    const matched    = hit.size;
    const grandTotal = applied.rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const skipped    = codes.filter(k => !hit.has(k));

    // Compared against the codes actually attempted, not the raw row count —
    // blank-code rows are dropped above and would otherwise make a fully
    // successful upload look partial.
    const status = matched === 0 && codes.length > 0 ? 'failed'
                 : skipped.length > 0                ? 'partial' : 'success';

    await c.query(
      `INSERT INTO outstanding_upload_log
         (uploaded_by, filename, as_of_date, rows_total, rows_matched,
          rows_skipped, skipped_codes, grand_total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [email, filename, asOfDate, rows.length, matched, skipped.length, skipped, grandTotal, status],
    );

    await c.query('COMMIT');
    revalidatePath('/risansi/admin/outstanding');
    return { matched, skipped: skipped.length, skippedCodes: skipped, grandTotal };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
