import NextAuth, { type AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { RisansiAccessStatus } from '@/types/risansi';

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (
          credentials?.email    === process.env.ADMIN_EMAIL &&
          credentials?.password === process.env.ADMIN_PASSWORD
        ) {
          return { id: '1', email: process.env.ADMIN_EMAIL!, name: 'Admin' };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token }) {
      if (token.email === process.env.ADMIN_EMAIL) {
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
