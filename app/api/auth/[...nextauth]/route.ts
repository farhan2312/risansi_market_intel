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
          // Single query: pull access state plus the linked rep (if any).
          // access_requests.rep_id is the canonical link, set at approval.
          const res = await risansiPool.query<{
            status: string; role: string; display_name: string | null;
            rep_id: number | null; rep_name: string | null;
            rep_initials: string | null; rep_zone: string | null;
          }>(
            `SELECT
               ar.status,
               ar.role,
               ar.display_name,
               ar.rep_id,
               r.name      AS rep_name,
               r.initials  AS rep_initials,
               r.zone      AS rep_zone
             FROM access_requests ar
             LEFT JOIN reps r ON ar.rep_id = r.id
             WHERE ar.user_email = $1
             LIMIT 1`,
            [email],
          );

          const row = res.rows[0];

          if (row) {
            token.risansiAccess = row.status;
            token.role          = row.role;
            token.repId         = row.rep_id ?? null;
            // Prefer the rep's canonical name when linked, else display_name.
            token.name = row.rep_name ?? row.display_name ?? token.name;
          } else {
            token.risansiAccess = 'Pending';
            token.role          = 'rep';
            token.repId         = null;
          }

          // Fallback: a rep account with no rep_id linked yet — try to match
          // by email, then backfill access_requests so future logins skip this.
          if (token.role === 'rep' && !token.repId) {
            const repByEmail = await risansiPool.query<{ id: number; name: string }>(
              `SELECT id, name FROM reps WHERE email = $1 AND is_active = TRUE LIMIT 1`,
              [email],
            );
            if (repByEmail.rows[0]) {
              token.repId = repByEmail.rows[0].id;
              token.name  = repByEmail.rows[0].name;
              await risansiPool.query(
                `UPDATE access_requests SET rep_id = $1
                 WHERE user_email = $2 AND rep_id IS NULL`,
                [token.repId, email],
              );
            }
          }
        } catch (err) {
          console.error('JWT callback error:', err);
          token.risansiAccess = 'Pending';
          token.role          = 'rep';
          token.repId         = null;
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
