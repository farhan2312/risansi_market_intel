import type { ReactNode, CSSProperties } from 'react';

export type TagKind = 'pos' | 'neg' | 'warn' | 'info' | 'accent';

export interface TagProps {
  kind?:     TagKind;
  dot?:      boolean;
  children?: ReactNode;
}

const KIND_STYLES: Record<TagKind, CSSProperties> = {
  pos:    { background: 'var(--pos-soft)',  color: 'var(--pos)',  borderColor: 'color-mix(in oklch, var(--pos)  20%, transparent)' },
  neg:    { background: 'var(--neg-soft)',  color: 'var(--neg)',  borderColor: 'color-mix(in oklch, var(--neg)  20%, transparent)' },
  warn:   { background: 'var(--warn-soft)', color: 'oklch(0.42 0.14 65)', borderColor: 'color-mix(in oklch, var(--warn) 25%, transparent)' },
  info:   { background: 'var(--info-soft)', color: 'var(--info)', borderColor: 'color-mix(in oklch, var(--info)  20%, transparent)' },
  accent: { background: 'var(--accent-soft)', color: 'oklch(0.45 0.14 50)', borderColor: 'color-mix(in oklch, var(--accent) 25%, transparent)' },
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderRadius: 3,
  background: 'var(--bg-sunk)',
  color: 'var(--fg-2)',
  border: '1px solid var(--line)',
  whiteSpace: 'nowrap',
};

export function Tag({ kind, dot, children }: TagProps) {
  const style: CSSProperties = { ...BASE, ...(kind ? KIND_STYLES[kind] : {}) };
  return (
    <span style={style}>
      {dot && (
        <span style={{
          width: 5, height: 5,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}
