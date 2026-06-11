// Next.js 16 renamed the `middleware` file convention to `proxy` (the
// `middleware` export is deprecated). See node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md. `proxy` runs on the Node.js
// runtime, which is what next-auth's getToken-based `withAuth` needs anyway.
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const proxy = withAuth(
  function proxy(req) {
    const token    = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Not logged in → signin (withAuth also guards this; kept explicit).
    if (!token) {
      return NextResponse.redirect(new URL('/api/auth/signin', req.url));
    }

    // Pending / Rejected / Revoked → blocked page.
    if (token.risansiAccess !== 'Approved') {
      return NextResponse.redirect(new URL('/api/auth/signup/pending', req.url));
    }

    // /admin → sysadmin only.
    if (pathname.startsWith('/admin') && token.role !== 'sysadmin') {
      return NextResponse.redirect(new URL('/risansi', req.url));
    }

    // /risansi/admin/* → admin or sysadmin only.
    if (
      pathname.startsWith('/risansi/admin') &&
      !['admin', 'sysadmin'].includes(token.role as string)
    ) {
      return NextResponse.redirect(new URL('/risansi', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  },
);

export default proxy;

export const config = {
  matcher: [
    '/risansi/:path*',
    '/admin/:path*',
  ],
};
