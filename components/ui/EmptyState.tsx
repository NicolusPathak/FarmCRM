// components/ui/EmptyState.tsx
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';

interface Props {
  Icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}

export default function EmptyState({ Icon, title, description, actionLabel, actionHref }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 24px', textAlign: 'center' }}>
      {Icon && (
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
          <Icon size={22} strokeWidth={1.6} />
        </div>
      )}
      <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, letterSpacing: '-0.005em' }}>{title}</p>
      {description && <p style={{ fontSize: 13.5, color: 'var(--ink-muted)', marginBottom: 20, maxWidth: 320, lineHeight: 1.45 }}>{description}</p>}
      {actionLabel && actionHref && <Link href={actionHref} className="btn-primary">{actionLabel}</Link>}
    </div>
  );
}
