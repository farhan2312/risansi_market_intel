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

    // 2. Apply the new sheet, matching on client code.
    let matched = 0, grandTotal = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      const code = (r.client_code ?? '').trim().toUpperCase();
      if (!code) continue;
      const debtor  = (r.debtor ?? '').trim().toUpperCase();
      const ownerId = DEBTOR_USER[debtor] ?? null;
      const amount  = Number(r.amount) || 0;
      const res = await c.query(
        `UPDATE clients
            SET total_outstanding = $2, outstanding_as_of = $3,
                outstanding_owner_id = $4, outstanding_debtor_code = $5
          WHERE UPPER(code) = $1 AND deleted_at IS NULL`,
        [code, amount, asOfDate, ownerId, debtor || null],
      );
      if (res.rowCount && res.rowCount > 0) { matched++; grandTotal += amount; }
      else skipped.push(code);
    }

    const status = skipped.length === rows.length ? 'failed'
                 : skipped.length > 0             ? 'partial' : 'success';

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
