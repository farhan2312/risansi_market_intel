'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const INPUT_STYLE = {
  padding: '9px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  background: '#F4F6FB',
  border: '1px solid rgba(10,22,40,0.16)',
  borderRadius: 6,
  color: '#0D1B2E',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const LABEL_STYLE = {
  fontSize: 11, fontWeight: 500 as const, color: '#2D3E55',
  letterSpacing: '0.04em', textTransform: 'uppercase' as const,
};

export default function SignUpPage() {
  const router = useRouter();
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [role,     setRole]     = useState('rep');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.toLowerCase().endsWith('@risansi.com')) {
      setError('Only @risansi.com email addresses are allowed');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email.toLowerCase().trim(), password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      router.push('/api/auth/signup/pending');
    } catch (err: unknown) {
      console.error('Signup error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
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
      {/* ── Left panel ─────────────────────────────────────────── */}
      <div style={{
        background: '#0A1628',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 56px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}
          viewBox="0 0 600 900" fill="none" preserveAspectRatio="xMidYMid slice"
        >
          <circle cx="500" cy="200" r="300" stroke="#00A3C4" strokeWidth="80"/>
          <circle cx="100" cy="700" r="200" stroke="#1A5CB8" strokeWidth="60"/>
          <line x1="0" y1="450" x2="600" y2="450" stroke="#fff" strokeWidth="1"/>
          <line x1="300" y1="0" x2="300" y2="900" stroke="#fff" strokeWidth="1"/>
        </svg>
        <div style={{ position: 'relative' }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '8px 14px', display: 'inline-flex', alignItems: 'center' }}>
            <img src="/logo.png" alt="Risansi Industries Ltd" style={{ height: '48px', width: 'auto', objectFit: 'contain', display: 'block' }} />
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <p style={{ fontSize: 28, fontWeight: 300, color: '#ffffff', lineHeight: 1.35, letterSpacing: '-0.01em', marginBottom: 16 }}>
            Intelligence for<br />
            <span style={{ color: '#00A3C4', fontWeight: 500 }}>every customer</span>
          </p>
          <p style={{ fontSize: 13, color: '#4A6FA5', lineHeight: 1.6, maxWidth: 320 }}>
            Request access to the Risansi intelligence platform. Once approved by your administrator, you can sign in.
          </p>
        </div>
        <div style={{ position: 'relative', fontSize: 11, color: '#2D4A6E' }}>
          Risansi Industries Ltd · Internal use only
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────── */}
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

          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D1B2E', letterSpacing: '-0.01em', marginBottom: 6 }}>
              Create Account
            </h1>
            <p style={{ fontSize: 13, color: '#6B7F96' }}>
              Request access to Risansi Intelligence
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={LABEL_STYLE}>Full Name *</label>
              <input
                type="text" required value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your full name"
                style={INPUT_STYLE}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={LABEL_STYLE}>Email *</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@risansi.com"
                style={INPUT_STYLE}
              />
              {email && !email.toLowerCase().endsWith('@risansi.com') && (
                <div style={{ fontSize: 11, color: '#DC2626' }}>
                  Only @risansi.com email addresses are allowed
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={LABEL_STYLE}>Password * (min 8 chars)</label>
              <input
                type="password" required minLength={8} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={INPUT_STYLE}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={LABEL_STYLE}>Confirm Password *</label>
              <input
                type="password" required value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={INPUT_STYLE}
              />
              {confirm && password !== confirm && (
                <div style={{ fontSize: 11, color: '#DC2626' }}>Passwords do not match</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={LABEL_STYLE}>Role</label>
              <select
                value={role} onChange={e => setRole(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: 'pointer' }}
              >
                <option value="rep">Field Rep</option>
                <option value="manager">Sales Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {error && (
              <div style={{
                padding: '8px 12px', background: '#FEE2E2',
                border: '1px solid rgba(220,38,38,0.20)',
                borderRadius: 5, fontSize: 12, color: '#9B1C1C',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                marginTop: 4, padding: '11px 0', fontSize: 13,
                fontFamily: 'inherit', fontWeight: 500,
                background: loading ? '#4A7FC1' : '#1A5CB8',
                color: '#ffffff', border: 'none', borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Submitting…' : 'Request Access'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 16, marginBottom: 0, fontSize: 13, color: '#6B7F96' }}>
            Already have an account?{' '}
            <a href="/api/auth/signin" style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 500 }}>
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
