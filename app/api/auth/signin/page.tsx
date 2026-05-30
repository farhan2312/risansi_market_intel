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
      background: '#f6f3ec',
      display: 'grid',
      placeItems: 'center',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid rgba(28,26,23,0.10)',
        borderRadius: 10,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 380,
        boxShadow: '0 4px 24px rgba(28,26,23,0.08)',
      }}>

        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 48,
              color: 'oklch(0.62 0.13 50)',
              lineHeight: 1,
              fontWeight: 400,
            }}>R</span>
            <span style={{
              fontWeight: 600,
              fontSize: 22,
              letterSpacing: '-0.01em',
              color: '#1c1a17',
            }}>isansi</span>
          </div>
          <p style={{
            fontSize: 12,
            color: '#837e74',
            marginTop: 6,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>Market Intelligence</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4a4640', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@risansi.com"
              style={{
                padding: '9px 11px',
                fontSize: 13,
                fontFamily: 'inherit',
                background: '#faf9f7',
                border: '1px solid rgba(28,26,23,0.18)',
                borderRadius: 6,
                color: '#1c1a17',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'oklch(0.62 0.13 50)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(28,26,23,0.18)')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4a4640', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
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
                padding: '9px 11px',
                fontSize: 13,
                fontFamily: 'inherit',
                background: '#faf9f7',
                border: '1px solid rgba(28,26,23,0.18)',
                borderRadius: 6,
                color: '#1c1a17',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'oklch(0.62 0.13 50)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(28,26,23,0.18)')}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 11px',
              background: 'oklch(0.96 0.04 30)',
              border: '1px solid oklch(0.88 0.08 30)',
              borderRadius: 5,
              fontSize: 12,
              color: 'oklch(0.45 0.14 30)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 6,
              padding: '10px 0',
              fontSize: 13,
              fontFamily: 'inherit',
              fontWeight: 500,
              background: loading ? 'oklch(0.72 0.10 50)' : 'oklch(0.62 0.13 50)',
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

        <p style={{ fontSize: 11, color: '#b7b1a3', textAlign: 'center', marginTop: 24, marginBottom: 0 }}>
          Risansi · Internal use only
        </p>
      </div>
    </div>
  );
}
