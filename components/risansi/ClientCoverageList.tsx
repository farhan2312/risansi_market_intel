'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface CoverageClient {
  id:              string;
  code:            string;
  legal_name:      string;
  city:            string | null;
  state:           string | null;
  country:         string | null;
  industry:        string | null;
  tier:            string | null;
  last_visit_date: string | null;
  rep_name:        string | null;
}

type FilterType = 'all' | 'compliant' | 'overdue' | 'never';

export function ClientCoverageList({ clients }: { clients: CoverageClient[] }) {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<FilterType>('all');

  const filtered = clients.filter(c => {
    if (search &&
      !c.legal_name.toLowerCase().includes(search.toLowerCase()) &&
      !(c.code ?? '').toLowerCase().includes(search.toLowerCase())
    ) return false;

    if (filter === 'compliant') {
      if (!c.last_visit_date) return false;
      return Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86_400_000) <= 90;
    }
    if (filter === 'overdue') {
      if (!c.last_visit_date) return false;
      return Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86_400_000) > 90;
    }
    if (filter === 'never') return !c.last_visit_date;
    return true;
  });

  return (
    <div style={{
      background: 'var(--bg-paper)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)',
      position: 'sticky', top: 16,
      maxHeight: 680,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#0A3D8F',
        }}>
          All Clients
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>
          {filtered.length} shown
        </span>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '6px 10px',
            border: '1px solid var(--line-strong)', borderRadius: 5,
            fontSize: 12, background: 'var(--bg-elev)', color: 'var(--fg)',
            boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {(['all', 'compliant', 'overdue', 'never'] as const).map((val, i) => {
          const labels = { all: 'All', compliant: '✓ OK', overdue: '⚠ Due', never: '✗ Never' };
          return (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                flex: 1, padding: '7px 2px', border: 'none', background: 'none',
                fontSize: 11, fontWeight: filter === val ? 600 : 400, cursor: 'pointer',
                color: filter === val ? '#0A3D8F' : 'var(--fg-3)',
                borderBottom: filter === val ? '2px solid #0A3D8F' : '2px solid transparent',
                fontFamily: 'inherit',
              }}
            >
              {labels[val]}
            </button>
          );
        })}
      </div>

      {/* Scrollable list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 12 }}>
            No clients match
          </div>
        ) : (
          filtered.map(c => {
            const days = c.last_visit_date
              ? Math.floor((Date.now() - new Date(c.last_visit_date).getTime()) / 86_400_000)
              : null;
            const dot = days === null ? '#DC2626' : days <= 30 ? '#0E9F6E' : days <= 90 ? '#D97706' : '#DC2626';
            return (
              <Link
                key={c.id}
                href={`/risansi/clients/${c.code}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderBottom: '1px solid var(--line)',
                  textDecoration: 'none', background: 'var(--bg-paper)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-paper)')}
              >
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 500, color: 'var(--fg)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.legal_name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
                    {c.city || c.state || '—'}
                    {c.industry ? ` · ${c.industry}` : ''}
                  </div>
                </div>
                <div style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: dot, flexShrink: 0, textAlign: 'right',
                }}>
                  {days === null ? 'Never' : days === 0 ? 'Today' : `${days}d`}
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '7px 12px', borderTop: '1px solid var(--line)',
        fontSize: 11, color: 'var(--fg-3)', textAlign: 'center', flexShrink: 0,
      }}>
        {filtered.length} of {clients.length} clients
      </div>
    </div>
  );
}
