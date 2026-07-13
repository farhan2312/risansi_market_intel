import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';

// Quoted items + quote-level attributes for one opportunity (read view in the
// opportunity drawer).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ items: [], meta: null });

  const user = await getCurrentUser();
  const opp = (await risansiPool.query(
    `SELECT client_id, quote_ref, quote_date::text, enquiry_no, enquiry_date::text,
            revised_offer_date::text, market, ril_rep, qtn_prepared_by, client_status_at_quote,
            unit_project, location, qtr, probability_code,
            offer_value_inr::float AS offer_value_inr, offer_value_usd::float AS offer_value_usd,
            revised_offer_value_inr::float AS revised_offer_value_inr, revised_offer_value_usd::float AS revised_offer_value_usd,
            quotation_link
       FROM opportunities WHERE id = $1`, [oppId])).rows[0];
  if (!opp) return NextResponse.json({ items: [], meta: null }, { status: 404 });
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return NextResponse.json({ items: [], meta: null }, { status: 403 });
  }

  const { rows } = await risansiPool.query(
    `SELECT id, pump_model, pump_qty, pump_speed, geared_motor_detail,
            motor_price::float AS motor_price, gearbox_vbelt_price::float AS gearbox_vbelt_price,
            offer_value_inr::float AS offer_value_inr, offer_value_usd::float AS offer_value_usd,
            detailed_specifications
       FROM opportunity_items WHERE opportunity_id = $1 ORDER BY sort_order, id`, [oppId]);

  return NextResponse.json({ items: rows, meta: opp });
}
