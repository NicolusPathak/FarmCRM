'use client';
import { useState } from 'react';
import { LoadingLink as Link, useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Snowflake, UserX, Phone, Check, Loader2, TrendingDown,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import type { RetentionResult, RetentionCustomer, RetentionBucket } from '@/lib/retention-types';

type Filter = 'all' | RetentionBucket;

const TABS: { value: Filter; label: string; description: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { value: 'all',      label: 'All',              description: 'Every customer worth contacting',  Icon: AlertTriangle },
  { value: 'slipping', label: 'Slipping regular', description: 'Were on a steady cadence, now broke it', Icon: TrendingDown },
  { value: 'cold',     label: "Haven't returned", description: 'Past your cold-customer threshold', Icon: Snowflake },
  { value: 'one_time', label: 'One-time only',    description: 'Came once, never came back',        Icon: UserX },
];

const BUCKET_LABEL: Record<RetentionBucket, string> = {
  slipping: 'Slipping regular',
  cold:     "Haven't returned",
  one_time: 'One-time only',
};

const BUCKET_COLOR: Record<RetentionBucket, string> = {
  slipping: 'var(--warning)',
  cold:     'var(--danger)',
  one_time: 'var(--ink-2)',
};

const BUCKET_BG: Record<RetentionBucket, string> = {
  slipping: 'var(--warning-bg)',
  cold:     'var(--danger-bg)',
  one_time: 'var(--surface-2)',
};

export default function RetentionClient({ initial }: { initial: RetentionResult }) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [contacting, setContacting] = useState<string | null>(null);

  const all = [...data.slipping, ...data.cold, ...data.one_time];
  const filtered: RetentionCustomer[] =
    filter === 'all' ? all :
    filter === 'slipping' ? data.slipping :
    filter === 'cold' ? data.cold :
    data.one_time;

  async function markContacted(c: RetentionCustomer) {
    setContacting(c.customer.id);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/retention/${c.customer.id}/contact`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
        // Drop from local lists
        setData(d => ({
          ...d,
          slipping: d.slipping.filter(x => x.customer.id !== c.customer.id),
          cold:     d.cold.filter(x => x.customer.id !== c.customer.id),
          one_time: d.one_time.filter(x => x.customer.id !== c.customer.id),
          total: d.total - 1,
        }));
        toast.success(`Marked ${c.customer.full_name} as contacted`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setContacting(null);
      }
    });
  }

  const counts = {
    all: all.length,
    slipping: data.slipping.length,
    cold: data.cold.length,
    one_time: data.one_time.length,
  };

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const active = filter === t.value;
          const count = counts[t.value];
          return (
            <button key={t.value} onClick={() => setFilter(t.value)}
              className={active ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '9px 14px', fontSize: 13 }}>
              <t.Icon size={14} />
              {t.label}
              <span style={{
                marginLeft: 6, padding: '1px 7px', borderRadius: 999,
                background: active ? 'rgba(250,248,244,0.18)' : 'var(--surface-2)',
                color: active ? 'var(--bg)' : 'var(--ink-muted)',
                fontSize: 11, fontWeight: 600,
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16, maxWidth: 720, lineHeight: 1.5 }}>
        {TABS.find(t => t.value === filter)!.description}.
        {' '}Contacted customers stay hidden for {data.settings.contacted_suppress_days} days.
      </p>

      {/* List */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <EmptyState Icon={Check}
            title="Nothing to worry about"
            description={
              filter === 'all'
                ? 'No customers currently match any retention concern. Nice work.'
                : `No customers in this bucket right now.`
            }
          />
        ) : (
          <div>
            {filtered.map((c, i) => (
              <Row
                key={c.customer.id}
                entry={c}
                showBucket={filter === 'all'}
                isLast={i === filtered.length - 1}
                contacting={contacting === c.customer.id}
                onMark={() => markContacted(c)}
              />
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Row({ entry, showBucket, isLast, contacting, onMark }: {
  entry: RetentionCustomer;
  showBucket: boolean;
  isLast: boolean;
  contacting: boolean;
  onMark: () => void;
}) {
  const c = entry.customer;
  const lastSeen = entry.last_order_at ? formatDate(entry.last_order_at) : '—';
  const daysAgoLabel = entry.days_since_last >= 365
    ? `${Math.floor(entry.days_since_last / 365)} year${Math.floor(entry.days_since_last / 365) === 1 ? '' : 's'} ago`
    : entry.days_since_last >= 30
      ? `${Math.floor(entry.days_since_last / 30)} month${Math.floor(entry.days_since_last / 30) === 1 ? '' : 's'} ago`
      : `${entry.days_since_last} day${entry.days_since_last === 1 ? '' : 's'} ago`;

  return (
    <div className="retention-row" style={{
      padding: '14px 18px',
      borderBottom: isLast ? 'none' : '1px solid var(--border-soft)',
    }}>
      <Link href={`/customers/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
        <Avatar name={c.full_name} size="sm" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.full_name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{c.customer_number}</span>
            {showBucket && (
              <span style={{
                fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: BUCKET_COLOR[entry.bucket], background: BUCKET_BG[entry.bucket],
                padding: '1px 6px', borderRadius: 4,
              }}>{BUCKET_LABEL[entry.bucket]}</span>
            )}
          </div>
        </div>
      </Link>

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{daysAgoLabel}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 1 }}>
          Last visit · {lastSeen}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>
          {entry.order_count} order{entry.order_count === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 1 }}>
          {entry.median_gap_days !== null
            ? `Typically every ${Math.max(1, Math.round(entry.median_gap_days))} day${Math.round(entry.median_gap_days) === 1 ? '' : 's'}`
            : 'No cadence yet'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {c.phone_number && (
          <a href={`tel:${c.phone_number.replace(/[^\d+]/g, '')}`} className="btn-secondary" style={{ padding: '7px 10px', fontSize: 12.5 }}>
            <Phone size={13} /> Call
          </a>
        )}
        <button onClick={onMark} disabled={contacting} className="btn-primary" style={{ padding: '7px 10px', fontSize: 12.5 }}>
          {contacting ? <Loader2 size={12} className="spin" /> : <Check size={13} />}
          Contacted
        </button>
      </div>
    </div>
  );
}
