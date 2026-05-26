'use client';
import { useRef, useState } from 'react';
import { useLoadingAction } from '@/components/ui/GlobalLoading';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AuditLogEntry } from '@/types';

interface Props {
  initial: AuditLogEntry[];
  total: number;
  pageSize: number;
}

const ACTION_LABEL: Record<string, string> = {
  created:           'Created',
  updated:           'Updated',
  voided:            'Voided',
  archived:          'Deleted',
  restored:          'Restored',
  pin_created:       'PIN created',
  pin_revoked:       'PIN revoked',
  pin_reset:         'PIN reset',
  staff_login:       'Sign-in',
  owner_login:       'Owner sign-in',
  order_reassigned:  'Reassigned',
  'export.customers':'Export customers',
  'export.orders':   'Export orders',
  'export.audit':    'Export audit log',
};

const ACTION_COLOR: Record<string, string> = {
  created:           'var(--success)',
  updated:           'var(--warning)',
  voided:            'var(--danger)',
  archived:          'var(--danger)',
  restored:          'var(--success)',
  pin_created:       'var(--success)',
  pin_revoked:       'var(--danger)',
  pin_reset:         'var(--warning)',
  staff_login:       'var(--ink-2)',
  owner_login:       'var(--brand)',
  order_reassigned:  'var(--warning)',
  'export.customers':'var(--ink-2)',
  'export.orders':   'var(--ink-2)',
  'export.audit':    'var(--ink-2)',
};

const FILTERS: { value: string; label: string }[] = [
  { value: '',         label: 'All' },
  { value: 'customer', label: 'Customers' },
  { value: 'order',    label: 'Orders' },
  { value: 'staff',    label: 'PINs' },
  { value: 'export',   label: 'Exports' },
  { value: 'settings', label: 'Settings' },
];

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

// Both empty = no date filter. Either side alone is allowed; if both
// are set, from must be on or before to.
function isValidDateFilter(from: string, to: string): boolean {
  if (!from && !to) return true;
  if (from && !YYYY_MM_DD.test(from)) return false;
  if (to   && !YYYY_MM_DD.test(to))   return false;
  if (from && to && from > to) return false;
  return true;
}

// `_meta` is request context (ip, user_agent) attached by logAudit. We
// surface those bits separately next to the actor instead of dumping the
// raw JSON into the changes list.
function describeChanges(changes: any): React.ReactNode {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  const keys = Object.keys(changes).filter((k) => k !== '_meta');
  if (keys.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {keys.map((k) => {
        const v = changes[k];
        const fromTo = v && typeof v === 'object' && 'from' in v && 'to' in v;
        if (fromTo) {
          return (
            <div key={k} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--text)' }}>{k.replace(/_/g, ' ')}: </span>
              <span style={{ textDecoration: 'line-through' }}>{formatValue(v.from)}</span>
              <span style={{ margin: '0 6px' }}>→</span>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{formatValue(v.to)}</span>
            </div>
          );
        }
        return (
          <div key={k} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--text)' }}>{k.replace(/_/g, ' ')}: </span>
            <span>{formatValue(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function actorIp(changes: any): string | null {
  if (!changes || typeof changes !== 'object') return null;
  const ip = changes._meta?.ip;
  return typeof ip === 'string' && ip.length > 0 ? ip : null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  try { return JSON.stringify(v); } catch { return String(v); }
}

export default function ActivityClient({ initial, total, pageSize }: Props) {
  const withLoading = useLoadingAction();
  const [entries, setEntries] = useState<AuditLogEntry[]>(initial);
  const [count, setCount] = useState(total);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [loading, setLoading] = useState(false);

  // Monotonic counter so we can discard responses from stale requests when
  // the user clicks filters rapidly. Without this, a slow earlier fetch can
  // land on top of a faster later one and put the UI in an inconsistent
  // state ("Orders" tab selected but Customer rows displayed).
  const requestSeq = useRef(0);

  async function load(opts: { filter?: string; from?: string; to?: string; reset?: boolean }) {
    const myReq = ++requestSeq.current;
    setLoading(true);
    await withLoading(async () => {
      try {
        const offset = opts.reset ? 0 : entries.length;
        const f  = opts.filter ?? filter;
        const fr = opts.from   ?? from;
        const tr = opts.to     ?? to;
        const url = new URL('/api/activity', window.location.origin);
        url.searchParams.set('limit', String(pageSize));
        url.searchParams.set('offset', String(offset));
        if (f)  url.searchParams.set('entity_type', f);
        if (fr) url.searchParams.set('from', fr);
        if (tr) url.searchParams.set('to',   tr);
        const res = await fetch(url.toString());
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error ?? `Could not load activity (${res.status}).`);
        }
        const data = await res.json();
        // Stale-response guard.
        if (myReq !== requestSeq.current) return;
        if (opts.reset) setEntries(data.entries ?? []);
        else setEntries((prev) => [...prev, ...(data.entries ?? [])]);
        setCount(data.total ?? 0);
      } catch (err: any) {
        if (myReq !== requestSeq.current) return; // ignore stale errors too
        toast.error(err?.message ?? 'Could not load activity.');
      } finally {
        if (myReq === requestSeq.current) setLoading(false);
      }
    });
  }

  function changeFilter(next: string) {
    setFilter(next);
    load({ filter: next, reset: true });
  }

  function changeFrom(next: string) {
    setFrom(next);
    if (isValidDateFilter(next, to)) load({ from: next, reset: true });
  }

  function changeTo(next: string) {
    setTo(next);
    if (isValidDateFilter(from, next)) load({ to: next, reset: true });
  }

  function clearDates() {
    setFrom('');
    setTo('');
    load({ from: '', to: '', reset: true });
  }

  const dateRangeOk = isValidDateFilter(from, to);
  const hasDateFilter = Boolean(from || to);

  return (
    <div>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => changeFilter(f.value)}
            className={filter === f.value ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '8px 16px', fontSize: 13 }}>
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {count} total
        </div>
      </div>

      {/* Date range */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          From
          <input type="date" className="input-field" max={to || undefined}
            style={{ width: 160, padding: '8px 10px' }}
            value={from} onChange={(e) => changeFrom(e.target.value)} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          To
          <input type="date" className="input-field" min={from || undefined}
            style={{ width: 160, padding: '8px 10px' }}
            value={to} onChange={(e) => changeTo(e.target.value)} />
        </label>
        {hasDateFilter && (
          <button onClick={clearDates} className="btn-secondary"
            style={{ padding: '8px 12px', fontSize: 12 }}>
            Clear dates
          </button>
        )}
        {!dateRangeOk && (
          <span style={{ fontSize: 12, color: 'var(--danger)' }}>
            "From" must be on or before "To".
          </span>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {entries.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No activity yet.
          </div>
        ) : (
          <div>
            {entries.map((e, i) => {
              const color = ACTION_COLOR[e.action] ?? 'var(--text-muted)';
              const ip = actorIp(e.changes);
              return (
                <div key={e.id} className="activity-row" style={{
                  padding: '14px 20px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTs(e.created_at)}</div>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', background: color, padding: '3px 8px', borderRadius: 4 }}>
                      {ACTION_LABEL[e.action] ?? e.action}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>{e.entity_type}</span>
                      {e.entity_label && (
                        <>
                          <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
                          <span style={{ fontWeight: 600 }}>{e.entity_label}</span>
                        </>
                      )}
                    </div>
                    {describeChanges(e.changes)}
                  </div>
                  <div style={{ fontSize: 12, textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{e.actor_name}</div>
                    <div style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>{e.actor_role}</div>
                    {ip && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', marginTop: 2 }}>
                        {ip}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {entries.length < count && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => load({})} disabled={loading} className="btn-secondary" style={{ padding: '10px 18px' }}>
            {loading ? <><Loader2 size={14} className="spin" /> Loading…</> : `Load ${Math.min(pageSize, count - entries.length)} more`}
          </button>
        </div>
      )}
      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
