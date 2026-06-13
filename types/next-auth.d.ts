import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      risansiAccess: string;
      role: string;
      repId: number | null;
      mustChange: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    risansiAccess: string;
    role: string;
    repId: number | null;
    mustChange: boolean;
  }
}
