'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateTaskStatus } from '@/app/actions/risansi-tasks';

export interface QueueTask {
  id: number;
  title: string;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to_external: string | null;
  assigned_rep_name: string | null;
  client_id: number | null;
  client_code: string | null;
  client_name: string | null;
}

const PRIORITY_DOT: Record<string, string> = {
  High:   'var(--neg)',
  Medium: 'var(--warn)',
  Low:    'var(--pos)',
};

export function ActionQueueRow({ task }: { task: QueueTask }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const isOverdue = !!task.due_date && task.status === 'open' && new Date(task.due_date) < new Date();

  const handleToggle = async () => {
    setLoading(true);
    await updateTaskStatus(task.id, task.status === 'open' ? 'completed' : 'open');
    router.refresh();
    setLoading(false);
  };

  const assignee = task.assigned_rep_name && task.assigned_rep_name !== '—'
    ? task.assigned_rep_name
    : task.assigned_to_external ?? 'Unassigned';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px',
      borderBottom: '1px solid var(--line-2)',
      opacity: task.status === 'completed' ? 0.5 : 1,
      background: isOverdue ? 'rgba(220,38,38,0.03)' : 'transparent',
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: PRIORITY_DOT[task.priority ?? 'Medium'] ?? PRIORITY_DOT.Medium,
        flexShrink: 0, marginTop: 5,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--fg)',
          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--fg-3)', marginTop: 2, flexWrap: 'wrap' }}>
          {task.client_code && task.client_name && (
            <a href={`/risansi/clients/${task.client_code}`} style={{ color: 'var(--brand-blue)', textDecoration: 'none' }}>
              {task.client_name}
            </a>
          )}
          {task.due_date && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400,
            }}>
              {isOverdue ? '⚠ ' : ''}
              {new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </span>
          )}
          <span>→ {assignee}</span>
        </div>
      </div>

      <button
        onClick={handleToggle}
        disabled={loading}
        style={{
          flexShrink: 0, padding: '3px 8px', borderRadius: 5,
          border: `1px solid ${task.status === 'completed' ? 'var(--line-strong)' : 'var(--pos)'}`,
          background: task.status === 'completed' ? 'var(--bg-elev)' : 'var(--pos-soft)',
          color: task.status === 'completed' ? 'var(--fg-3)' : 'var(--pos)',
          fontSize: 10, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '…' : task.status === 'completed' ? '↩ Reopen' : '✓ Done'}
      </button>
    </div>
  );
}
