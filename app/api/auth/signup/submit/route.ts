import { NextRequest, NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import bcrypt from 'bcryptjs';

const VALID_ROLES = ['rep', 'manager', 'admin'];

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, role } = await req.json();

    if (!email || !email.endsWith('@risansi.com')) {
      return NextResponse.json({ error: 'Only @risansi.com emails allowed' }, { status: 400 });
    }
    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

    const hashed = await bcrypt.hash(password, 10);

    await risansiPool.query(
      `INSERT INTO access_requests (email, display_name, role, status, requested_at)
       VALUES ($1, $2, $3, 'Pending', NOW())
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role         = EXCLUDED.role,
         status       = 'Pending',
         requested_at = NOW()`,
      [email, name.trim(), safeRole],
    );

    await risansiPool.query(
      `UPDATE access_requests SET password_hash = $1 WHERE email = $2`,
      [hashed, email],
    );

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
  }
}
