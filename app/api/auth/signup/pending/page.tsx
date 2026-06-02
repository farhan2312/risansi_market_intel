export default function PendingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#EEF2FA',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid rgba(10,22,40,0.08)',
        borderRadius: 12,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 440,
        textAlign: 'center',
        boxShadow: '0 4px 24px rgba(10,61,143,0.10)',
      }}>
        {/* Check icon */}
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#D1FAE5', border: '2px solid #059669',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none"
               stroke="#059669" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D1B2E', letterSpacing: '-0.01em', marginBottom: 12 }}>
          Request Submitted
        </h1>

        <p style={{ fontSize: 14, color: '#6B7F96', lineHeight: 1.6, marginBottom: 32 }}>
          Your account request is pending approval from the system administrator.
          You will be able to log in once approved.
        </p>

        <a
          href="/api/auth/signin"
          style={{
            display: 'inline-block',
            padding: '10px 24px',
            background: '#1A5CB8',
            color: '#fff',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Back to Sign In
        </a>

        <p style={{ fontSize: 11, color: '#A8BAC8', marginTop: 32 }}>
          Risansi Industries Ltd · Internal use only
        </p>
      </div>
    </div>
  );
}
