'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { submitOpportunity } from '@/app/actions/risansi';
import { Toast } from './Toast';

// ── Constants ──────────────────────────────────────────────────

const STAGE_DEFAULTS: Record<string, number> = {
  Suspect:     20,
  Prospect:    40,
  Quoted:      60,
  Negotiating: 75,
};

const STAGE_DOT: Record<string, string> = {
  Suspect:     '#94A3B8',
  Prospect:    '#1A5CB8',
  Quoted:      '#D97706',
  Negotiating: '#EA580C',
};

// ── Props ──────────────────────────────────────────────────────

interface Props {
  clientId:    string;
  clientName:  string;
  clientCode:  string;
  industry:    string;
  onClose:     () => void;
}

// ── Component ──────────────────────────────────────────────────

export function NewOpportunityDrawer({
  clientId, clientName, clientCode, industry, onClose,
}: Props) {
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [stage, setStage]            = useState('Suspect');
  const [probability, setProbability] = useState(20);
  const [error, setError]            = useState('');
  const [toast, setToast]            = useState(false);

  function handleStageChange(newStage: string) {
    setStage(newStage);
    setProbability(STAGE_DEFAULTS[newStage] ?? 25);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('client_id', clientId);
    startTransition(async () => {
      try {
        await submitOpportunity(fd);
        setToast(true);
        setTimeout(() => {
          onClose();
          router.refresh();
        }, 1400);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create opportunity — please try again.');
      }
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(10,22,40,0.35)',
        }}
      />

      {/* Slide-in drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: 'translateX(0)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
              New Opportunity
            </div>
            <div style={{ fontSize: 11, color: '#6B7FA3', marginTop: 2 }}>
              {clientName} · {clientCode}
            </div>
          </div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {/* Hidden fields */}
          <input type="hidden" name="client_id" value={clientId} />

          {/* ── Section: Opportunity Details ─── */}
          <div>
            <div style={SECTION_TITLE}>Opportunity Details</div>

            {/* Product Description */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Product Description <Req /></label>
              <input
                type="text"
                name="product"
                required
                placeholder="e.g. PCP × 3 MX-80 · Spent Wash application"
                style={INP}
              />
            </div>

            {/* Product Type */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Product Type <Req /></label>
              <select name="product_type" style={INP} required>
                <option value="PCP">PCP</option>
                <option value="MMP">MMP</option>
                <option value="Spares">Spares</option>
                <option value="Service">Service</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Stage */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Stage <Req /></label>
              <select
                name="stage"
                value={stage}
                onChange={e => handleStageChange(e.target.value)}
                style={INP}
                required
              >
                {Object.keys(STAGE_DEFAULTS).map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {/* Stage dot legend */}
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                {Object.entries(STAGE_DOT).map(([s, color]) => (
                  <span key={s} style={{ fontSize: 11, color: '#6B7FA3', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Estimated Value */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Estimated Value (₹ Lakhs)</label>
              <input
                type="number"
                name="value_lakh"
                min="0"
                step="0.1"
                placeholder="e.g. 12.5"
                style={INP}
              />
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
                Enter in Lakhs — e.g. 12.5 for ₹12.5 Lakhs (stored as ₹0.125 Cr)
              </div>
            </div>

            {/* Probability */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Probability %</label>
              <input
                type="number"
                name="probability"
                min="0"
                max="100"
                value={probability}
                onChange={e => setProbability(parseInt(e.target.value, 10) || 0)}
                style={INP}
              />
            </div>

            {/* Expected Close */}
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Expected Close</label>
              <input
                type="text"
                name="eta_text"
                placeholder="e.g. Jun 2026 or Q3 FY27"
                style={INP}
              />
            </div>

            {/* Quote Reference */}
            <div style={{ marginBottom: 0 }}>
              <label style={LBL}>Quote Reference</label>
              <input
                type="text"
                name="quote_ref"
                placeholder="e.g. Q-2024-018"
                style={INP}
              />
            </div>
          </div>

          {/* ── Section: Notes ─── */}
          <div>
            <div style={SECTION_TITLE}>Notes</div>
            <textarea
              name="notes"
              rows={4}
              maxLength={1000}
              placeholder="Any additional context, competitive intel, or follow-up actions…"
              style={{ ...INP, height: 'auto', resize: 'vertical', paddingTop: 9, paddingBottom: 9, lineHeight: 1.5 }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '9px 12px',
              background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)',
              borderRadius: 5, fontSize: 12, color: '#9B1C1C',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isPending || toast}
            style={{
              ...SUBMIT_BTN,
              opacity: isPending || toast ? 0.55 : 1,
              cursor: isPending || toast ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'Creating…' : 'Create Opportunity'}
          </button>
        </form>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message="Opportunity created · added to pipeline"
          type="success"
          onDismiss={() => setToast(false)}
        />
      )}
    </>
  );
}

// ── Tiny helper ────────────────────────────────────────────────

function Req() {
  return <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>;
}

// ── Styles ─────────────────────────────────────────────────────

const SECTION_TITLE: CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.10em', color: '#0A3D8F',
  marginBottom: 14, paddingBottom: 8,
  borderBottom: '1px solid #EBF1FB',
};

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: '#6B7FA3', borderRadius: 4,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '9px 12px',
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
  letterSpacing: '-0.005em', marginTop: 4,
};
