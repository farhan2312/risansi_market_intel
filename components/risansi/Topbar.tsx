'use client';

import { Bell, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type Crumb = string | { label: string; href: string };

export interface TopbarProps {
  crumbs: Crumb[];
  primaryAction?: string;
  primaryActionHref?: string;
}

export function Topbar({ crumbs, primaryAction, primaryActionHref }: TopbarProps) {
  return (
    <header className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-paper)] px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--fg-3)]">
        {crumbs.map((c, i) => {
          const label = typeof c === 'string' ? c : c.label;
          const href = typeof c === 'string' ? undefined : c.href;
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={12} className="text-[var(--fg-4)]" />}
              {isLast ? (
                <strong className="font-semibold text-[var(--brand-blue)]">{label}</strong>
              ) : href ? (
                <a href={href} className="text-[var(--fg-3)] no-underline hover:text-[var(--fg-2)]">
                  {label}
                </a>
              ) : (
                <span className="text-[var(--fg-3)]">{label}</span>
              )}
            </span>
          );
        })}
      </nav>

      {/* Live indicator — pushed right */}
      <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--pos)]">
        <span className="live-dot" />
        <span className="mono text-[11px]">Live · synced 2s ago</span>
      </div>

      {/* Notifications */}
      <Button variant="ghost" size="icon-sm" aria-label="Notifications">
        <Bell />
      </Button>

      {/* Primary action */}
      {primaryAction && primaryActionHref && (
        <Button asChild size="sm">
          <a href={primaryActionHref}>
            <Plus />
            {primaryAction}
          </a>
        </Button>
      )}
      {primaryAction && !primaryActionHref && (
        <Button size="sm">
          <Plus />
          {primaryAction}
        </Button>
      )}
    </header>
  );
}
