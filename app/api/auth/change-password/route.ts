import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { currentPw, newPw } = await req.json();

    if (!currentPw || !newPw) {
      return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    }
    if (typeof newPw !== 'string' || newPw.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 },
      );
    }

    // Passwords live in access_requests.password_hash (same table the
    // credentials provider authenticates against). Match its lookup exactly.
    const email = session.user.email.toLowerCase().trim();

    const userRes = await risansiPool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM access_requests
       WHERE user_email = $1 AND status = 'Approved'
       LIMIT 1`,
      [email],
    );

    const hash = userRes.rows[0]?.password_hash;
    if (!hash) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPw, hash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Cost factor 10 to match the existing signup flow (app/api/auth/signup/submit).
    const newHash = await bcrypt.hash(newPw, 10);

    await risansiPool.query(
      `UPDATE access_requests SET password_hash = $1
       WHERE user_email = $2 AND status = 'Approved'`,
      [newHash, email],
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
