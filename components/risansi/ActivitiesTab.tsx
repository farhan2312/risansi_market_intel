'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateTaskStatus } from '@/app/actions/risansi-tasks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

export interface ActivityTask {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to_external: string | null;
  assigned_rep_name: string | null;
  client_id: number | null;
  client_code: string | null;
  client_name: string | null;
  visit_id: number | null;
  visit_date: string | null;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High:   { bg: 'var(--neg-soft)',  text: 'var(--neg)'  },
  Medium: { bg: 'var(--warn-soft)', text: 'var(--warn)' },
  Low:    { bg: 'var(--pos-soft)',  text: 'var(--pos)'  },
};

const SELECT_STYLE: CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)',
};

function ActionStatusToggle({ task, compact, onToggle }: {
  task: ActivityTask; compact?: boolean; onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const handleToggle = async () => {
    setLoading(true);
    await updateTaskStatus(task.id, task.status === 'open' ? 'completed' : 'open');
    onToggle();
    setLoading(false);
  };

  if (compact) {
    return (
      <Button variant="ghost" size="sm" onClick={handleToggle} disabled={loading} style={{ fontSize: 10 }}>
        {loading ? '…' : task.status === 'completed' ? '↩' : '✓'}
      </Button>
    );
  }

  return (
    <Badge
      onClick={handleToggle}
      style={{
        background: task.status === 'completed' ? 'var(--pos-soft)' : 'var(--bg-elev)',
        color: task.status === 'completed' ? 'var(--pos)' : 'var(--fg-3)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {loading ? '…' : task.status === 'completed' ? '✓ Done' : 'Open'}
    </Badge>
  );
}

export function ActivitiesTab({ tasks }: { tasks: ActivityTask[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const refresh = () => router.refresh();

  const openCount      = tasks.filter(t => t.status !== 'completed').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const overdueCount   = tasks.filter(t => t.status === 'open' && !!t.due_date && new Date(t.due_date) < new Date()).length;

  const q = search.trim().toLowerCase();
  const filtered = tasks.filter(t => {
    if (q && !`${t.title} ${t.description ?? ''} ${t.client_name ?? ''}`.toLowerCase().includes(q)) return false;
    if (priorityFilter && (t.priority ?? 'Medium') !== priorityFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 16, padding: '12px 0 16px', fontSize: 12, color: 'var(--fg-3)' }}>
        <span><strong style={{ color: 'var(--fg)' }}>{openCount}</strong> open</span>
        <span>·</span>
        <span style={{ color: 'var(--neg)' }}><strong>{overdueCount}</strong> overdue</span>
        <span>·</span>
        <span><strong style={{ color: 'var(--pos)' }}>{completedCount}</strong> completed</span>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={SELECT_STYLE}>
          <option value="">All Priorities</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={SELECT_STYLE}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          No tasks match the current filters.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Visit</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(task => {
              const isOverdue = !!task.due_date && task.status === 'open' && new Date(task.due_date) < new Date();
              const pc = PRIORITY_COLORS[task.priority ?? 'Medium'] ?? PRIORITY_COLORS.Medium;
              return (
                <TableRow key={task.id} style={{ opacity: task.status === 'completed' ? 0.6 : 1, background: isOverdue ? 'rgba(220,38,38,0.03)' : undefined }}>
                  <TableCell><ActionStatusToggle task={task} onToggle={refresh} /></TableCell>
                  <TableCell>
                    <div style={{ fontWeight: 500, fontSize: 12, textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>
                      {task.title}
                    </div>
                    {task.description && (
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                        {task.description.slice(0, 60)}{task.description.length > 60 ? '…' : ''}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.client_code && task.client_name ? (
                      <a href={`/risansi/clients/${task.client_code}`} style={{ fontSize: 12, color: 'var(--brand-blue)', textDecoration: 'none' }}>
                        {task.client_name}
                      </a>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge style={{ background: pc.bg, color: pc.text, fontSize: 10 }}>
                      {task.priority ?? 'Medium'}
                    </Badge>
                  </TableCell>
                  <TableCell style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400 }}>
                    {task.due_date ? new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    {isOverdue && ' ⚠'}
                  </TableCell>
                  <TableCell style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {task.assigned_rep_name && task.assigned_rep_name !== '—' ? task.assigned_rep_name : (task.assigned_to_external ?? '—')}
                  </TableCell>
                  <TableCell>
                    {task.visit_id && (
                      <a href={`/risansi/visits/${task.visit_id}`} style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none' }}>
                        {task.visit_date ? new Date(task.visit_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Visit →'}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActionStatusToggle task={task} compact onToggle={refresh} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
