'use client';

import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function SignInPage() {
  const router   = useRouter();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password.');
    } else {
      router.push('/risansi');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* ── Left panel — brand ─────────────────────────────── */}
      <div style={{
        background: '#0A1628',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 56px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Geometric background accents */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}
          viewBox="0 0 600 900" fill="none" preserveAspectRatio="xMidYMid slice"
        >
          <circle cx="500" cy="200" r="300" stroke="#00A3C4" strokeWidth="80"/>
          <circle cx="100" cy="700" r="200" stroke="#1A5CB8" strokeWidth="60"/>
          <line x1="0" y1="450" x2="600" y2="450" stroke="#fff" strokeWidth="1"/>
          <line x1="300" y1="0" x2="300" y2="900" stroke="#fff" strokeWidth="1"/>
        </svg>

        {/* Logo */}
        <div style={{ position: 'relative' }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '8px 14px', display: 'inline-flex', alignItems: 'center' }}>
            <img src="/logo.png" alt="Risansi Industries Ltd" style={{ height: '48px', width: 'auto', objectFit: 'contain', display: 'block' }} />
          </div>
        </div>

        {/* Tagline */}
        <div style={{ position: 'relative' }}>
          <p style={{
            fontSize: 28,
            fontWeight: 300,
            color: '#ffffff',
            lineHeight: 1.35,
            letterSpacing: '-0.01em',
            marginBottom: 16,
          }}>
            Intelligence for<br />
            <span style={{ color: '#00A3C4', fontWeight: 500 }}>every customer</span>
          </p>
          <p style={{ fontSize: 13, color: '#4A6FA5', lineHeight: 1.6, maxWidth: 320 }}>
            Real-time competitive positioning, visit analytics,
            and revenue intelligence for the Risansi field team.
          </p>
        </div>

        {/* Footer */}
        <div style={{ position: 'relative', fontSize: 11, color: '#2D4A6E' }}>
          Risansi Industries Ltd · Internal use only
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────── */}
      <div style={{
        background: '#EEF2FA',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px',
      }}>
        <div style={{
          background: '#ffffff',
          border: '1px solid rgba(10,22,40,0.08)',
          borderRadius: 12,
          padding: '36px 32px',
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 4px 24px rgba(10,61,143,0.10)',
        }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', background: '#F0F4FA', borderRadius: 10, padding: '8px 16px', border: '1px solid #DDE6F5' }}>
            <img
              src="/logo.png"
              alt="Risansi Industries Ltd"
              style={{ height: '56px', width: 'auto', objectFit: 'contain', display: 'inline-block' }}
            />
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 32 }}>
            <h1 style={{
              fontSize: 22,
              fontWeight: 600,
              color: '#0D1B2E',
              letterSpacing: '-0.01em',
              marginBottom: 6,
            }}>
              Sign in
            </h1>
            <p style={{ fontSize: 13, color: '#6B7F96' }}>
              Access the Risansi intelligence platform
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{
                fontSize: 11, fontWeight: 500, color: '#2D3E55',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@risansi.com"
                style={{
                  padding: '9px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: '#F4F6FB',
                  border: '1px solid rgba(10,22,40,0.16)',
                  borderRadius: 6,
                  color: '#0D1B2E',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = '#1A5CB8')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(10,22,40,0.16)')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{
                fontSize: 11, fontWeight: 500, color: '#2D3E55',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  padding: '9px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: '#F4F6FB',
                  border: '1px solid rgba(10,22,40,0.16)',
                  borderRadius: 6,
                  color: '#0D1B2E',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = '#1A5CB8')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(10,22,40,0.16)')}
              />
            </div>

            {error && (
              <div style={{
                padding: '8px 12px',
                background: '#FEE2E2',
                border: '1px solid rgba(220,38,38,0.20)',
                borderRadius: 5,
                fontSize: 12,
                color: '#9B1C1C',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                padding: '11px 0',
                fontSize: 13,
                fontFamily: 'inherit',
                fontWeight: 500,
                background: loading ? '#4A7FC1' : '#1A5CB8',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                letterSpacing: '-0.005em',
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{
            fontSize: 11, color: '#A8BAC8',
            textAlign: 'center', marginTop: 28, marginBottom: 0,
          }}>
            Risansi Industries Ltd · Internal use only
          </p>
        </div>
      </div>
    </div>
  );
}
