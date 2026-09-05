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
      /** Function this person works in, or null for the sales roles. */
      department: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    risansiAccess: string;
    role: string;
    repId: number | null;
    mustChange: boolean;
    department: string | null;
  }
}
