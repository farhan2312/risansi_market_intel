import { NextResponse } from 'next/server'
import risansiPool from '@/lib/db-risansi'

export async function GET() {
  try {
    const [clients, competitors, orders] = await Promise.all([
      risansiPool.query('SELECT COUNT(*) as count FROM clients'),
      risansiPool.query('SELECT COUNT(*) as count FROM competitor_installed_base'),
      risansiPool.query('SELECT COUNT(*) as count FROM orders'),
    ])
    const sample = await risansiPool.query(
      'SELECT code, legal_name, status, rev_2526_pump, rev_2526_spare FROM clients LIMIT 5'
    )
    return NextResponse.json({
      counts: {
        clients:     clients.rows[0].count,
        competitors: competitors.rows[0].count,
        orders:      orders.rows[0].count,
      },
      sample: sample.rows,
      db:   process.env.RISANSI_DB_NAME,
      host: process.env.DB_HOST?.replace(/./g, '*').slice(-8),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
