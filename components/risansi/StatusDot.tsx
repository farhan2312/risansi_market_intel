export type StatusKind = 'active' | 'inactive' | 'prospect';

export interface StatusDotProps {
  s: StatusKind;
}

const DOT_COLOR: Record<StatusKind, string> = {
  active:   'var(--pos)',
  inactive: 'var(--fg-4, #b7b1a3)',
  prospect: 'var(--info)',
};

export function StatusDot({ s }: StatusDotProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: DOT_COLOR[s] ?? 'var(--fg-4)',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    />
  );
}
