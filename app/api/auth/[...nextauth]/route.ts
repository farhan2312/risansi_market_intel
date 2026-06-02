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

        // Sysadmin bypass via env vars
        const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@risansi.com').toLowerCase();
        const adminPass  = process.env.ADMIN_PASSWORD ?? 'risansi2026';
        if (email === adminEmail && pass === adminPass) {
          return { id: '1', email: adminEmail, name: 'Admin' };
        }

        // Check access_requests for approved users
        const res = await risansiPool.query<{
          email: string; display_name: string; password_hash: string | null;
          status: string; role: string;
        }>(
          `SELECT email, display_name, password_hash, status, role
           FROM access_requests
           WHERE email = $1 AND status = 'Approved'
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
          name:  row.display_name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Check if sysadmin via ADMIN_EMAILS env var
        const adminEmails = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? 'admin@risansi.com')
          .split(',').map(e => e.trim().toLowerCase());

        if (adminEmails.includes(token.email?.toLowerCase() ?? '')) {
          token.role = 'sysadmin';
          token.risansiAccess = 'Approved';
        } else {
          // Look up role from access_requests
          const res = await risansiPool.query<{ status: string; role: string }>(
            `SELECT status, role FROM access_requests WHERE user_email = $1 LIMIT 1`,
            [token.email],
          );
          token.risansiAccess = res.rows[0]?.status ?? 'Pending';
          token.role          = res.rows[0]?.role   ?? 'rep';
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.risansiAccess = (token.risansiAccess as string) ?? 'Pending';
        session.user.role          = (token.role          as string) ?? 'rep';
      }
      return session;
    },
  },
  pages: {
    signIn: '/api/auth/signin',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
