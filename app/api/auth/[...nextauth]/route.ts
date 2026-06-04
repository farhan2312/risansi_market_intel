import NextAuth, { type AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import risansiPool from '@/lib/db-risansi';

export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? 'risansi-dev-secret-2026',
  session: {
    strategy: 'jwt' as const,
    maxAge:   8 * 60 * 60,  // 8 hours
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim() ?? '';
        const pass  = credentials?.password ?? '';

        const res = await risansiPool.query<{
          user_email: string; display_name: string; password_hash: string | null;
          status: string; role: string;
        }>(
          `SELECT user_email, display_name, password_hash, status, role
           FROM access_requests
           WHERE user_email = $1 AND status = 'Approved'
           LIMIT 1`,
          [email],
        );

        const row = res.rows[0];
        if (!row || !row.password_hash) return null;

        const bcrypt = await import('bcryptjs');
        const valid  = await bcrypt.compare(pass, row.password_hash);
        if (!valid) return null;

        return {
          id:    row.user_email,
          email: row.user_email,
          name:  row.display_name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user || token.email) {
        const email = (token.email ?? '').toLowerCase().trim();

        try {
          const res = await risansiPool.query<{ status: string; role: string; display_name: string }>(
            `SELECT status, role, display_name
             FROM access_requests
             WHERE user_email = $1
             LIMIT 1`,
            [email],
          );

          if (res.rows[0]) {
            token.risansiAccess = res.rows[0].status;
            token.role          = res.rows[0].role;
            token.name          = res.rows[0].display_name;
          } else {
            token.risansiAccess = 'Pending';
            token.role          = 'rep';
          }
        } catch (err) {
          console.error('JWT DB lookup error:', err);
          token.risansiAccess = 'Pending';
          token.role          = 'rep';
        }

        // rep_id is a newer column — fetch separately so a missing column
        // can never break authentication for everyone.
        try {
          const repRes = await risansiPool.query<{ rep_id: number | null }>(
            `SELECT rep_id FROM access_requests WHERE user_email = $1 LIMIT 1`,
            [email],
          );
          token.repId = repRes.rows[0]?.rep_id ?? null;
        } catch {
          token.repId = null;
        }

        // Once linked to a rep, use the canonical name from the reps table
        // (which approval overwrote with the user's display_name) instead of
        // the access_requests display_name, so the session shows the same
        // name that all client/visit records resolve to.
        if (token.repId) {
          try {
            const nameRes = await risansiPool.query<{ name: string | null }>(
              'SELECT name FROM reps WHERE id = $1 LIMIT 1',
              [token.repId],
            );
            if (nameRes.rows[0]?.name) token.name = nameRes.rows[0].name;
          } catch { /* keep display_name fallback */ }
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.risansiAccess = token.risansiAccess as string;
      session.user.role          = token.role          as string;
      session.user.repId         = (token.repId as number | null) ?? null;
      return session;
    },
  },
  pages: {
    signIn: '/api/auth/signin',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
