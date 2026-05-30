import NextAuth, { type AuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import risansiPool from '@/lib/db-risansi';
import type { RisansiAccessStatus } from '@/types/risansi';

export const authOptions: AuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Runs on every sign-in (account present) and subsequent requests
      if (account && token.email) {
        try {
          const { rows } = await risansiPool.query<{ status: RisansiAccessStatus }>(
            `SELECT status FROM access_requests
             WHERE email = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [token.email],
          );
          token.risansiAccess = rows[0]?.status ?? null;
        } catch {
          token.risansiAccess = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.risansiAccess = (token.risansiAccess as RisansiAccessStatus | null) ?? null;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
