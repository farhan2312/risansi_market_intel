import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Sidebar } from '@/components/risansi';

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

  const email    = session.user.email;
  const isAdmin  = email === process.env.ADMIN_EMAIL;
  const fontClasses = `${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`;

  return (
    <div
      className={fontClasses}
      style={{
        fontFamily: 'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)',
        WebkitFontSmoothing: 'antialiased',
        fontSize: 13,
        lineHeight: 1.45,
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#f6f3ec',
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
      <main style={{ flex: 1, overflowY: 'auto', background: '#f6f3ec', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
