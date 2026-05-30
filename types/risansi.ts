import 'next-auth';
import 'next-auth/jwt';

export type RisansiAccessStatus = 'Pending' | 'Approved' | 'Rejected' | 'Revoked';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      risansiAccess?: RisansiAccessStatus | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    risansiAccess?: RisansiAccessStatus | null;
  }
}
