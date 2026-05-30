import { notFound } from 'next/navigation';
import risansiPool from '@/lib/db-risansi';
import { VisitReportClient } from './VisitReportClient';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export interface ReportInitialData {
  visitId: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  industry: string;
  tcd: number | null;
  klpd: number | null;
  purpose: string;
  status: string;
  contacts: Array<{ id: string; name: string; designation: string | null; phone: string | null; is_primary: boolean }>;
  priorContactIds: string[];       // contacts already flagged from DB
  existingEquipment: Array<{       // last known equipment for reference
    supplier: string;
    station: string | null;
    model: string | null;
    quantity: number;
    condition: string;
  }>;
}

export default async function VisitReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch visit with client info
  const visitRow = await q<{
    id: string; client_id: string; purpose: string; status: string;
    client_name: string; client_code: string; industry: string;
    tcd: number | null; klpd: number | null;
  } | null>(async () => {
    const { rows } = await risansiPool.query<{
      id: string; client_id: string; purpose: string; status: string;
      client_name: string; client_code: string; industry: string;
      tcd: string | null; klpd: string | null;
    }>(`
      SELECT v.id, v.client_id, COALESCE(v.purpose,'Routine') AS purpose, v.status,
             c.legal_name AS client_name, c.client_code, c.industry,
             c.tcd::text, c.klpd::text
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE v.id = $1
    `, [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r,
      tcd: r.tcd != null ? Number(r.tcd) : null,
      klpd: r.klpd != null ? Number(r.klpd) : null,
    };
  }, null);

  if (!visitRow) notFound();

  const clientId = visitRow.client_id;

  const [contacts, existingEquipment, priorContacts] = await Promise.all([

    q<ReportInitialData['contacts']>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; name: string; designation: string | null; phone: string | null; is_primary: boolean;
      }>(`
        SELECT id, name, designation, phone, is_primary
        FROM contacts WHERE client_id = $1
        ORDER BY is_primary DESC, name
      `, [clientId]);
      return rows;
    }, []),

    q<ReportInitialData['existingEquipment']>(async () => {
      const { rows } = await risansiPool.query<{
        supplier: string; station: string | null; model: string | null;
        quantity: string; condition: string;
      }>(`
        SELECT supplier, station, model, quantity::text, condition
        FROM equipment_assessment_entries
        WHERE client_id = $1
        ORDER BY (supplier = 'RIL') DESC, condition, station
        LIMIT 30
      `, [clientId]);
      return rows.map(r => ({ ...r, quantity: Number(r.quantity) }));
    }, []),

    // Previously met contacts for this visit (if visit_contacts table exists)
    q<string[]>(async () => {
      const { rows } = await risansiPool.query<{ contact_id: string }>(
        `SELECT contact_id FROM visit_contacts WHERE visit_id = $1`,
        [id],
      );
      return rows.map(r => r.contact_id);
    }, []),
  ]);

  const initialData: ReportInitialData = {
    visitId: id,
    clientId,
    clientName: visitRow.client_name,
    clientCode: visitRow.client_code,
    industry:   visitRow.industry,
    tcd:        visitRow.tcd,
    klpd:       visitRow.klpd,
    purpose:    visitRow.purpose,
    status:     visitRow.status,
    contacts,
    priorContactIds: priorContacts,
    existingEquipment,
  };

  return <VisitReportClient initialData={initialData} />;
}
