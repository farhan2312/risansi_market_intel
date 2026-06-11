'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// ── Month parsing ──────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04',
  May:'05', Jun:'06', Jul:'07', Aug:'08',
  Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};

function parseMonth(raw: string): string | null {
  const parts = raw?.trim().split('-');
  if (parts?.length !== 2) return null;
  const mon = MONTH_MAP[parts[0]];
  const yr  = parts[1];
  if (!mon || !/^\d{4}$/.test(yr)) return null;
  return `${yr}-${mon}-01`;
}

// ── uploadRevenue ──────────────────────────────────────────────

export interface UploadPayloadRow {
  client_code: string;
  month:       string;
  pump_value:  number;
  spare_value: number;
  filename:    string;
}

export interface UploadResult {
  inserted:     number;
  updated:      number;
  skipped:      number;
  skippedCodes: string[];
}

export async function uploadRevenue(rows: UploadPayloadRow[]): Promise<UploadResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;
  const skippedCodes: string[] = [];

  // Batch-lookup all client IDs
  const codes = [...new Set(rows.map(r => r.client_code))];
  const clientRes = await risansiPool.query<{ id: string; code: string }>(
    `SELECT id::text, UPPER(code) AS code
     FROM clients
     WHERE UPPER(code) = ANY($1::text[])
       AND deleted_at IS NULL`,
    [codes.map(c => c.toUpperCase())],
  );
  const codeToId: Record<string, string> = {};
  clientRes.rows.forEach(r => { codeToId[r.code] = r.id; });

  for (const row of rows) {
    const clientId  = codeToId[row.client_code.toUpperCase()];
    const monthDate = parseMonth(row.month);

    if (!clientId || !monthDate) {
      skipped++;
      if (!skippedCodes.includes(row.client_code)) {
        skippedCodes.push(row.client_code);
      }
      continue;
    }

    const pump  = Number(row.pump_value)  || 0;
    const spare = Number(row.spare_value) || 0;
    const total = pump + spare;

    // Check if exists (for count tracking)
    const existing = await risansiPool.query(
      `SELECT id FROM client_revenue_monthly WHERE client_id = $1 AND month = $2`,
      [clientId, monthDate],
    );

    await risansiPool.query(
      `INSERT INTO client_revenue_monthly
         (client_id, month, pump_value, spare_value, total_value, entered_by, entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (client_id, month) DO UPDATE SET
         pump_value  = EXCLUDED.pump_value,
         spare_value = EXCLUDED.spare_value,
         total_value = EXCLUDED.total_value,
         entered_by  = EXCLUDED.entered_by,
         entered_at  = NOW()`,
      [clientId, monthDate, pump, spare, total, session!.user!.email],
    );

    if (existing.rows.length > 0) updated++;
    else inserted++;
  }

  // Determine month from first valid row for the log
  const firstMonth = parseMonth(rows[0]?.month ?? '') ?? null;

  // Log the upload (silently — table may not exist yet)
  try {
    const status =
      skipped === rows.length ? 'failed' :
      skipped > 0             ? 'partial' : 'success';

    await risansiPool.query(
      `INSERT INTO revenue_upload_log
         (uploaded_by, filename, month, rows_total,
          rows_inserted, rows_updated, rows_skipped,
          skipped_codes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        session!.user!.email,
        rows[0]?.filename ?? 'unknown',
        firstMonth,
        rows.length,
        inserted,
        updated,
        skipped,
        skippedCodes,
        status,
      ],
    );
  } catch { /* revenue_upload_log may not exist — non-fatal */ }

  revalidatePath('/risansi/admin/revenue');
  return { inserted, updated, skipped, skippedCodes };
}

// ── deleteUpload ───────────────────────────────────────────────

export async function deleteUpload(logId: number, _month: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  // Get log entry
  const logRes = await risansiPool.query<{ uploaded_by: string; month: string }>(
    `SELECT uploaded_by, month FROM revenue_upload_log WHERE id = $1`,
    [logId],
  );
  if (!logRes.rows[0]) throw new Error('Upload log not found');

  const { uploaded_by, month: uploadMonth } = logRes.rows[0];

  // Remove revenue data that was entered by this uploader for that month
  await risansiPool.query(
    `DELETE FROM client_revenue_monthly WHERE month = $1 AND entered_by = $2`,
    [uploadMonth, uploaded_by],
  );

  // Remove log entry
  await risansiPool.query(`DELETE FROM revenue_upload_log WHERE id = $1`, [logId]);

  revalidatePath('/risansi/admin/revenue');
}
