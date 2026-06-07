import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import { getServerSession } from 'next-auth/next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Sidebar } from '@/components/risansi';
import type { SidebarRole } from '@/components/risansi/Sidebar';
import risansiPool from '@/lib/db-risansi';

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

function toSidebarRole(role: string): SidebarRole {
  if (role === 'sysadmin') return 'sysadmin';
  if (role === 'admin')    return 'admin';
  if (role === 'manager')  return 'manager';
  return 'rep';
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const headersList = await headers();
  const ua = headersList.get('user-agent') ?? '';
  const _isMobile = isMobileUA(ua);

  const email       = session.user.email;
  const role        = session.user.role ?? 'rep';
  const fontClasses = `${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`;

  // Pending access requests count — only fetched for admin/sysadmin
  let pendingCount = 0;
  if (['admin', 'sysadmin'].includes(role)) {
    try {
      const res = await risansiPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM access_requests WHERE status = 'Pending'`,
      );
      pendingCount = parseInt(res.rows[0]?.count ?? '0', 10);
    } catch { /* non-fatal */ }
  }

  return (
    <div
      className={fontClasses}
      style={{
        fontFamily:          'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)',
        WebkitFontSmoothing: 'antialiased',
        fontSize:            13,
        lineHeight:          1.45,
        display:             'flex',
        height:              '100vh',
        overflow:            'hidden',
        background:          '#F4F6FB',
      }}
    >
      <Sidebar
        role={toSidebarRole(role)}
        pendingCount={pendingCount}
        user={{
          name:     session.user.name ?? email,
          initials: getInitials(session.user.name ?? email),
          // Pass the raw lowercase role so UserMenu's ROLE_LABELS map resolves
          // it to a friendly label (e.g. 'rep' → 'Sales Representative').
          role:     role,
          email:    email,
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', background: '#F4F6FB', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
