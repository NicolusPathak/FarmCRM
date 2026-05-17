'use client';
// components/layout/PageHeader.tsx
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';
import { ChevronLeft } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, backHref, backLabel, actions }: Props) {
  return (
    <div style={{ marginBottom: 28 }}>
      {backHref && (
        <Link href={backHref} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12.5, color: 'var(--ink-muted)', textDecoration: 'none',
          marginBottom: 10, fontWeight: 500,
        }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
        >
          <ChevronLeft size={14} /> {backLabel ?? 'Back'}
        </Link>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 400, lineHeight: 1.15, margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 14, color: 'var(--ink-muted)', marginTop: 6 }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}
