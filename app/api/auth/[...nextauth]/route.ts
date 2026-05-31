import NextAuth, { type AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { RisansiAccessStatus } from '@/types/risansi';

const VALID_EMAIL    = process.env.ADMIN_EMAIL    ?? 'admin@risansi.com';
const VALID_PASSWORD = process.env.ADMIN_PASSWORD ?? 'risansi2026';

export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? 'risansi-dev-secret-2026',
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        console.log('LOGIN ATTEMPT:', {
          inputEmail:   credentials?.email,
          inputPassword: credentials?.password,
          envEmail:     process.env.ADMIN_EMAIL,
          envPassword:  process.env.ADMIN_PASSWORD,
        });

        if (
          credentials?.email    === VALID_EMAIL &&
          credentials?.password === VALID_PASSWORD
        ) {
          return { id: '1', email: VALID_EMAIL, name: 'Admin' };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token }) {
      if (token.email === VALID_EMAIL) {
        token.risansiAccess = 'Approved' as RisansiAccessStatus;
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
  pages: {
    signIn: '/api/auth/signin',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
