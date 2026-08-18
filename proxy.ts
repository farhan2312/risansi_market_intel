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

    // API callers get JSON they can act on; a browser gets sent somewhere it can
    // read. A link opened from a spreadsheet is a browser navigation to an /api
    // path, so the decision follows the Accept header rather than the prefix.
    const isApi = pathname.startsWith('/api/');
    const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
    const deny = (status: number, message: string, to: string) =>
      (isApi && !wantsHtml)
        ? NextResponse.json({ error: message }, { status })
        : NextResponse.redirect(new URL(to, req.url));

    // Not logged in → signin.
    if (!token) {
      return deny(401, 'Not signed in.', '/api/auth/signin');
    }

    // Pending / Rejected / Revoked → blocked.
    //
    // The jwt callback re-reads `users` on every request, so this is the live
    // status, not whatever it was at sign-in: revoking someone takes effect on
    // their very next request rather than when their 8-hour session expires.
    if (token.risansiAccess !== 'Approved') {
      return deny(403, 'Your access to the portal has been withdrawn.', '/api/auth/signup/pending');
    }

    // /admin → sysadmin only.
    if (pathname.startsWith('/admin') && token.role !== 'sysadmin') {
      return deny(403, 'Sysadmin only.', '/risansi');
    }

    // /risansi/admin/* → admin or sysadmin only.
    if (
      pathname.startsWith('/risansi/admin') &&
      !['admin', 'sysadmin'].includes(token.role as string)
    ) {
      return deny(403, 'Admins only.', '/risansi');
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Always run the function above. Returning false here would make next-auth
      // redirect to the sign-in PAGE, which is the wrong answer for an API call —
      // deny() needs to decide between JSON and a redirect itself.
      authorized: () => true,
    },
  },
);

export default proxy;

export const config = {
  matcher: [
    '/risansi/:path*',
    '/admin/:path*',
    // Print views render the same client and visit data as the portal pages and
    // were never matched, so they answered a revoked session in full.
    '/print/:path*',
    // The API was the real hole. Route handlers each authorise themselves, but
    // ~40 of them read the session through getServerSession rather than
    // getCurrentUser, so a status check added to that helper alone would have
    // missed them — and two lookup routes authenticate nothing at all.
    // Deliberately NOT matched: /api/auth/** (sign-in has to work for someone
    // holding no token) and /api/cron/** (guarded by CRON_SECRET, no session).
    '/api/risansi/:path*',
  ],
};
