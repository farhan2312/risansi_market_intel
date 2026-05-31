import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import { getServerSession } from 'next-auth/next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Sidebar } from '@/components/risansi';

// Deduplicate session calls across server components in the same request
const getSession = cache(() => getServerSession(authOptions));

const ibmPlexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

function isMobileUA(ua: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua);
}

export default async function RisansiLayout({ children }: { children: React.ReactNode }) {
  // ── Auth check ──────────────────────────────────────────────
  const session = await getSession();
  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  // ── Mobile UA detection ─────────────────────────────────────
  // Read UA here for future use (alerts, layout hints, etc).
  // The path-specific redirect (/risansi → /risansi/mobile) lives in
  // /app/risansi/page.tsx — layouts cannot determine which child segment
  // is being rendered, so doing a path-specific redirect here would loop
  // when the mobile sub-layout subsequently renders this parent layout.
  const headersList = await headers();
  const ua = headersList.get('user-agent') ?? '';
  const _isMobile = isMobileUA(ua); // available for sub-layout hints if needed

  // ── Shell ───────────────────────────────────────────────────
  const email      = session.user.email;
  const isAdmin    = email === (process.env.ADMIN_EMAIL ?? 'admin@risansi.com');
  const fontClasses = `${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`;

  // The Sidebar derives `active` from usePathname() internally —
  // no need to pass it from this server component.

  return (
    <div
      className={fontClasses}
      style={{
        fontFamily:           'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)',
        WebkitFontSmoothing:  'antialiased',
        fontSize:             13,
        lineHeight:           1.45,
        display:              'flex',
        height:               '100vh',
        overflow:             'hidden',
        background:           '#F4F6FB',
      }}
    >
      <Sidebar
        role={isAdmin ? 'admin' : 'manager'}
        user={{
          name:     session.user.name ?? email,
          initials: getInitials(session.user.name ?? email),
          role:     isAdmin ? 'Admin' : 'User',
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', background: '#F4F6FB', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
