'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addContact } from '@/app/actions/risansi';

// ── Event used by the page "+Add Contact" trigger button ────────
export const OPEN_ADD_CONTACT_DRAWER = 'risansi:open-add-contact-drawer';

// ── Small trigger button — dispatches the event ─────────────────
export function AddContactTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ADD_CONTACT_DRAWER))}
      style={GHOST_BTN}
    >
      + Add Contact
    </button>
  );
}

// ── Designations list ───────────────────────────────────────────
const DESIGNATIONS = [
  'GM Engineering', 'Chief Engineer', 'Deputy CE',
  'Purchase Officer', 'GM Production', 'AGM', 'DGM',
  'MD', 'Director', 'Other',
];

// ── Drawer props ────────────────────────────────────────────────

interface Props {
  clientId:   string;
  clientCode: string;
  open:       boolean;
  onClose:    () => void;
}

// ── Drawer component ────────────────────────────────────────────

export function AddContactDrawer({ clientId, clientCode, open, onClose }: Props) {
  const router                           = useRouter();
  const [isPending, startTransition]     = useTransition();
  const [error, setError]                = useState('');
  const [success, setSuccess]            = useState(false);
  const [sameAsPhone, setSameAsPhone]    = useState(false);
  const [phoneVal, setPhoneVal]          = useState('');
  const [formKey, setFormKey]            = useState(0);

  function close() {
    onClose();
    setError('');
    setSuccess(false);
    setSameAsPhone(false);
    setPhoneVal('');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('client_id', clientId);
    if (sameAsPhone && phoneVal) fd.set('whatsapp', phoneVal);

    startTransition(async () => {
      try {
        await addContact(fd);
        setSuccess(true);
        router.refresh();
        setTimeout(() => {
          close();
          setSuccess(false);
          setFormKey(k => k + 1);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add contact — please try again.');
      }
    });
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,22,40,0.35)' }}
        />
      )}

      {/* Slide-in drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 360, zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
        pointerEvents: open ? 'auto' : 'none',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
              Add Contact
            </div>
            <div style={{ fontSize: 11, color: '#6B7FA3', marginTop: 2, fontFamily: 'monospace' }}>
              {clientCode}
            </div>
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form */}
        <form
          key={formKey}
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
        >

          <Field label="Name" required>
            <input
              type="text"
              name="name"
              required
              maxLength={200}
              placeholder="Full name"
              style={INP}
            />
          </Field>

          <Field label="Designation">
            <select name="designation" style={INP}>
              <option value="">— Select —</option>
              {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <Field label="Phone" required>
            <input
              type="tel"
              name="phone"
              required
              maxLength={20}
              placeholder="+91 98765 43210"
              style={INP}
              value={phoneVal}
              onChange={e => setPhoneVal(e.target.value)}
            />
          </Field>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={sameAsPhone}
                onChange={e => setSameAsPhone(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#1A5CB8', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, color: '#2C3E5A' }}>WhatsApp same as phone</span>
            </label>
            {!sameAsPhone && (
              <Field label="WhatsApp">
                <input type="tel" name="whatsapp" maxLength={20} placeholder="+91 98765 43210" style={INP} />
              </Field>
            )}
          </div>

          <Field label="Email">
            <input type="email" name="email" maxLength={200} placeholder="name@company.com" style={INP} />
          </Field>

          <Field label="Relationship Notes">
            <textarea
              name="notes"
              rows={2}
              maxLength={500}
              placeholder="How they can help, communication preferences…"
              style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              name="is_primary"
              value="true"
              style={{ width: 14, height: 14, accentColor: '#1A5CB8', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: '#2C3E5A' }}>Set as primary contact</span>
          </label>

          {error && (
            <div style={{
              padding: '9px 12px',
              background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)',
              borderRadius: 5, fontSize: 12, color: '#9B1C1C',
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: '12px 16px', background: '#D1FAE5',
              border: '1px solid #6EE7B7', borderRadius: 6,
              fontSize: 13, color: '#065F46', textAlign: 'center', fontWeight: 600,
            }}>
              ✓ Contact added!
            </div>
          )}

          {!success && (
            <button
              type="submit"
              disabled={isPending}
              style={{ ...SUBMIT_BTN, opacity: isPending ? 0.55 : 1, cursor: isPending ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {isPending ? 'Adding…' : 'Add Contact'}
            </button>
          )}
        </form>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: '#6B7FA3', borderRadius: 4,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 6, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box',
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em',
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 10px', fontSize: 11, fontFamily: 'inherit',
  fontWeight: 500, background: 'transparent',
  border: '1px solid var(--line-strong, #CBD5E1)',
  color: 'var(--fg, #0D1B2A)',
  borderRadius: 5, cursor: 'pointer',
};
