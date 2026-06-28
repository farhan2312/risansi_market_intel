'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// Each uploaded row is one installed pump (unique serial), matching the EC/Serial
// ERP export. client_code is the portal code (CUST already reversed by the client);
// customer_code is the raw CUST. Stored in client_pumps, source='upload'.
export interface PumpPayloadRow {
  client_code:   string;
  customer_code: string;
  customer_name: string;
  model:         string;   // pump_model_plate
  sr_no:         string;   // pump_sl_no
  ec_no:         string;   // ec_number
  so_no:         string;   // so_number
  liquid:        string;
  capacity:      string;
  head:          string;
  filename:      string;
}

export interface PumpUploadResult {
  inserted:     number;
  updated:      number;
  skipped:      number;
  skippedCodes: string[];
}

const textOrNull = (s: string) => { const t = (s ?? '').trim(); return t === '' ? null : t; };

export async function uploadPumps(rows: PumpPayloadRow[]): Promise<PumpUploadResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }
  const email = session!.user!.email!;

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;
  const skippedCodes: string[] = [];

  // Batch-lookup client IDs by the (reversed) portal code.
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

  // Open the upload log first so every pump row can carry its upload_id.
  const logRes = await risansiPool.query<{ id: number }>(
    `INSERT INTO pump_upload_log (uploaded_by, filename, rows_total, status)
     VALUES ($1, $2, $3, 'processing') RETURNING id`,
    [email, rows[0]?.filename ?? 'unknown', rows.length],
  );
  const uploadId = logRes.rows[0].id;

  for (const row of rows) {
    const clientId = codeToId[row.client_code.toUpperCase()];
    if (!clientId) {
      skipped++;
      if (!skippedCodes.includes(row.customer_code)) skippedCodes.push(row.customer_code);
      continue;
    }

    // Upsert on serial (partial index uq_client_pumps_serial). Serial-less rows append.
    const res = await risansiPool.query<{ inserted: boolean }>(
      `INSERT INTO client_pumps
         (client_id, client_code, customer_code, customer_name, pump_model_plate,
          pump_sl_no, ec_number, so_number, liquid, capacity, head,
          quantity, source, upload_id, entered_by, entered_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'upload',$12,$13,NOW(),NOW())
       ON CONFLICT (client_id, pump_sl_no)
         WHERE pump_sl_no IS NOT NULL AND pump_sl_no <> ''
       DO UPDATE SET
         client_code      = EXCLUDED.client_code,
         customer_code    = EXCLUDED.customer_code,
         customer_name    = EXCLUDED.customer_name,
         pump_model_plate = EXCLUDED.pump_model_plate,
         ec_number        = EXCLUDED.ec_number,
         so_number        = EXCLUDED.so_number,
         liquid           = EXCLUDED.liquid,
         capacity         = EXCLUDED.capacity,
         head             = EXCLUDED.head,
         entered_by       = EXCLUDED.entered_by,
         entered_at       = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        clientId,
        row.client_code.toUpperCase(),
        textOrNull(row.customer_code),
        textOrNull(row.customer_name),
        textOrNull(row.model),
        textOrNull(row.sr_no),
        textOrNull(row.ec_no),
        textOrNull(row.so_no),
        textOrNull(row.liquid),
        textOrNull(row.capacity),
        textOrNull(row.head),
        uploadId,
        email,
      ],
    );

    if (res.rows[0]?.inserted) inserted++;
    else updated++;
  }

  const status =
    skipped === rows.length ? 'failed' :
    skipped > 0             ? 'partial' : 'success';

  await risansiPool.query(
    `UPDATE pump_upload_log
       SET rows_inserted = $2, rows_updated = $3, rows_skipped = $4,
           skipped_codes = $5, status = $6
     WHERE id = $1`,
    [uploadId, inserted, updated, skipped, skippedCodes, status],
  );

  revalidatePath('/risansi/admin/pumps');
  return { inserted, updated, skipped, skippedCodes };
}

export async function deletePumpUpload(logId: number): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  await risansiPool.query(`DELETE FROM client_pumps WHERE upload_id = $1`, [logId]);
  await risansiPool.query(`DELETE FROM pump_upload_log WHERE id = $1`, [logId]);

  revalidatePath('/risansi/admin/pumps');
}
