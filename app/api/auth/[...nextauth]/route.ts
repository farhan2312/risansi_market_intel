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

        // Unified users table is the source of truth for credentials + access.
        const res = await risansiPool.query<{
          email: string; name: string; password_hash: string | null;
          status: string; role: string;
        }>(
          `SELECT email, name, password_hash, status, role
           FROM users
           WHERE lower(email) = $1 AND status = 'Approved' AND is_active = TRUE
           LIMIT 1`,
          [email],
        );

        const row = res.rows[0];
        if (!row || !row.password_hash) return null;

        const bcrypt = await import('bcryptjs');
        const valid  = await bcrypt.compare(pass, row.password_hash);
        if (!valid) return null;

        return {
          id:    row.email,
          email: row.email,
          name:  row.name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user || token.email) {
        const email = (token.email ?? '').toLowerCase().trim();

        try {
          // Unified users table carries identity, role, access state and the
          // canonical id (same integer space as the old reps.id).
          const res = await risansiPool.query<{
            id: number; status: string; role: string; name: string | null;
            must_change_password: boolean;
          }>(
            `SELECT id, status, role, name, must_change_password
             FROM users
             WHERE lower(email) = $1 AND is_active = TRUE
             LIMIT 1`,
            [email],
          );

          const row = res.rows[0];

          if (row) {
            token.risansiAccess = row.status;
            token.role          = row.role;
            token.repId         = row.id;
            token.mustChange    = row.must_change_password;
            token.name          = row.name ?? token.name;
          } else {
            token.risansiAccess = 'Pending';
            token.role          = 'rep';
            token.repId         = null;
            token.mustChange    = false;
          }
        } catch (err) {
          console.error('JWT callback error:', err);
          token.risansiAccess = 'Pending';
          token.role          = 'rep';
          token.repId         = null;
          token.mustChange    = false;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.risansiAccess = token.risansiAccess as string;
      session.user.role          = token.role          as string;
      session.user.repId         = (token.repId as number | null) ?? null;
      session.user.mustChange    = (token.mustChange as boolean) ?? false;
      return session;
    },
  },
  pages: {
    signIn: '/api/auth/signin',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
