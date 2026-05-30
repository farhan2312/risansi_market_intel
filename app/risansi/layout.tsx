import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { requestAccess } from '@/app/actions/risansi';
import { Sidebar } from '@/components/risansi';
import type { RisansiAccessStatus } from '@/types/risansi';

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

export default async function RisansiLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const email = session.user.email;
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const isAdmin = adminEmails.includes(email);

  let accessStatus: RisansiAccessStatus | null = null;
  try {
    const { rows } = await risansiPool.query<{ status: RisansiAccessStatus }>(
      `SELECT status FROM access_requests WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    accessStatus = rows[0]?.status ?? null;
  } catch {
    // DB not yet available — treat as no record
  }

  const fontClasses = `${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`;
  const baseStyle: React.CSSProperties = {
    fontFamily: 'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)',
    WebkitFontSmoothing: 'antialiased',
    fontSize: 13,
    lineHeight: 1.45,
  };

  // ── Access denied ──────────────────────────────────────────
  if (!isAdmin && (accessStatus === 'Rejected' || accessStatus === 'Revoked')) {
    return (
      <div className={fontClasses} style={{ ...baseStyle, minHeight: '100vh', background: '#f6f3ec', display: 'grid', placeItems: 'center' }}>
        <div style={{
          background: '#fff',
          border: '1px solid rgba(28,26,23,0.10)',
          borderRadius: 10,
          padding: '48px 40px',
          maxWidth: 400,
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(28,26,23,0.08)',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginBottom: 28 }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 44, color: 'oklch(0.62 0.13 50)', lineHeight: 1 }}>R</span>
            <span style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-0.01em', color: '#1c1a17' }}>isansi</span>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: '#1c1a17', margin: '0 0 12px' }}>
            Access Denied
          </h1>
          <p style={{ fontSize: 13, color: '#837e74', lineHeight: 1.6, margin: 0 }}>
            Your access to Risansi has been {accessStatus === 'Revoked' ? 'revoked' : 'declined'}.
            Contact your administrator if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  // ── Request access overlay ─────────────────────────────────
  if (!isAdmin && accessStatus !== 'Approved') {
    const isPending = accessStatus === 'Pending';
    return (
      <div className={fontClasses} style={{ ...baseStyle, minHeight: '100vh', background: '#f6f3ec', display: 'grid', placeItems: 'center' }}>
        <div style={{
          background: '#fff',
          border: '1px solid rgba(28,26,23,0.10)',
          borderRadius: 10,
          padding: '48px 40px',
          maxWidth: 420,
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(28,26,23,0.08)',
        }}>
          {/* Brand mark */}
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginBottom: 28 }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 44, color: 'oklch(0.62 0.13 50)', lineHeight: 1 }}>R</span>
            <span style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-0.01em', color: '#1c1a17' }}>isansi</span>
          </div>

          <h1 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: '#1c1a17', margin: '0 0 12px' }}>
            {isPending ? 'Request Submitted' : 'Request Access'}
          </h1>

          <p style={{ fontSize: 13, color: '#837e74', lineHeight: 1.6, margin: '0 0 28px' }}>
            {isPending
              ? 'Your request is pending review. You will be notified once an administrator approves your access.'
              : 'Risansi is an internal sales intelligence platform. Submit a request and an administrator will review your access.'}
          </p>

          {!isPending && (
            <form action={requestAccess}>
              <button
                type="submit"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '9px 22px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  fontWeight: 500,
                  background: 'oklch(0.62 0.13 50)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  letterSpacing: '-0.005em',
                }}
              >
                Submit Request
              </button>
            </form>
          )}

          {isPending && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: 'oklch(0.94 0.06 85)',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              color: 'oklch(0.45 0.14 80)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>
              Pending Review
            </div>
          )}

          <p style={{ fontSize: 11, color: '#b7b1a3', marginTop: 24, marginBottom: 0 }}>
            Signed in as {email}
          </p>
        </div>
      </div>
    );
  }

  // ── App shell ──────────────────────────────────────────────
  return (
    <div
      className={fontClasses}
      style={{
        ...baseStyle,
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#f6f3ec',
      }}
    >
      <Sidebar
        role={isAdmin ? 'admin' : 'manager'}
        user={{
          name: session.user.name ?? email,
          initials: getInitials(session.user.name ?? email),
          role: isAdmin ? 'Admin' : 'User',
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', background: '#f6f3ec', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
