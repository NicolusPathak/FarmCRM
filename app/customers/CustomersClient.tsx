'use client';
import { useState, useRef, useCallback } from 'react';
import { useLoadingRouter } from '@/components/ui/GlobalLoading';
import { Search, X, Users, Loader2 } from 'lucide-react';
import type { Customer } from '@/types';
import { formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';

interface Props {
  customers: Customer[];
  total: number;
  pageSize: number;
  initialQuery: string;
}

export default function CustomersClient({ customers: initial, total: initialTotal, pageSize, initialQuery }: Props) {
  const router = useLoadingRouter();
  const [query,     setQuery]     = useState(initialQuery);
  const [customers, setCustomers] = useState(initial);
  const [total,     setTotal]     = useState(initialTotal);
  const [loading,   setLoading]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stale-response guard for rapid filter/search changes.
  const requestSeq = useRef(0);

  // Browse mode (no search query): paginated via /api/customers, supports
  // "Load more".
  const loadBrowse = useCallback(async (opts: { reset?: boolean }) => {
    const myReq = ++requestSeq.current;
    const setBusy = opts.reset ? setLoading : setLoadingMore;
    setBusy(true);
    try {
      const offset = opts.reset ? 0 : customers.length;
      const url = new URL('/api/customers', window.location.origin);
      url.searchParams.set('limit',  String(pageSize));
      url.searchParams.set('offset', String(offset));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (myReq !== requestSeq.current) return;
      const incoming = (d.customers ?? []) as Customer[];
      setCustomers((prev) => opts.reset ? incoming : [...prev, ...incoming]);
      setTotal(d.total ?? 0);
    } catch {
      if (myReq !== requestSeq.current) return;
      if (opts.reset) { setCustomers([]); setTotal(0); }
    } finally {
      if (myReq === requestSeq.current) setBusy(false);
    }
  }, [customers.length, pageSize]);

  const doSearch = useCallback(async (q: string) => {
    const myReq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { if (myReq === requestSeq.current) { setCustomers([]); setTotal(0); } return; }
      const d = await res.json();
      if (myReq !== requestSeq.current) return;
      const incoming = (d.customers ?? []) as Customer[];
      setCustomers(incoming);
      // Search has its own internal cap; show match count rather than DB total.
      setTotal(incoming.length);
    } catch {
      if (myReq === requestSeq.current) { setCustomers([]); setTotal(0); }
    } finally {
      if (myReq === requestSeq.current) setLoading(false);
    }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (v.trim()) doSearch(v);
      else          loadBrowse({ reset: true });
    }, 240);
  };

  function clearQuery() {
    setQuery('');
    if (debounce.current) clearTimeout(debounce.current);
    loadBrowse({ reset: true });
  }

  const inSearch    = query.trim().length > 0;
  const canLoadMore = !inSearch && customers.length < total;

  return (
    <div>
      <div className="search-bar" style={{ marginBottom: 18 }}>
        {loading
          ? <Loader2 size={16} strokeWidth={2} className="spin" style={{ color: 'var(--ink-muted)' }} />
          : <Search size={16} strokeWidth={2} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
        <input value={query} onChange={onInput} placeholder="Search by name, phone, customer #, city, street, or ZIP" autoFocus={!!initialQuery} />
        {query && (
          <button onClick={clearQuery} className="btn-ghost" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {customers.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState Icon={Users}
            title={query ? 'No customers found' : 'No customers yet'}
            description={query ? `Nothing matches “${query}”.` : 'Add your first customer to get started.'}
            actionLabel="Add customer" actionHref="/customers/new" />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Desktop / tablet table */}
          <table className="data-table customers-desktop">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>City</th>
                <th>Points</th>
                <th>Member since</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id} onClick={() => router.push(`/customers/${c.id}`)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={c.full_name} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{c.customer_number}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{c.phone_number ?? '—'}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{c.city ?? '—'}</td>
                  <td><span className="badge badge-neutral" style={{ whiteSpace: 'nowrap' }}>{c.points_balance.toLocaleString()}</span></td>
                  <td style={{ color: 'var(--ink-muted)' }}>{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile card list — shown < 640px; same data, stacked. The whole
              card is a tap target so staff can thumb-tap to drill in. */}
          <div className="customers-mobile">
            {customers.map(c => (
              <button
                key={c.id}
                type="button"
                className="cust-card"
                onClick={() => router.push(`/customers/${c.id}`)}
              >
                <Avatar name={c.full_name} size="sm" />
                <div className="cust-card__body">
                  <div className="cust-card__top">
                    <span className="cust-card__name">{c.full_name}</span>
                    <span className="badge badge-neutral cust-card__pts">{c.points_balance.toLocaleString()} pts</span>
                  </div>
                  <div className="cust-card__meta">
                    <span className="cust-card__num">{c.customer_number}</span>
                    {c.phone_number && <span className="cust-card__sep">·</span>}
                    {c.phone_number && <span>{c.phone_number}</span>}
                  </div>
                  {(c.city || c.zip_code) && (
                    <div className="cust-card__city">{[c.city, c.zip_code].filter(Boolean).join(', ')}</div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--ink-muted)' }}>
            {inSearch
              ? `${customers.length} customer${customers.length !== 1 ? 's' : ''} matching "${query}"`
              : `Showing ${customers.length} of ${total} customer${total !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}

      {canLoadMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => loadBrowse({})} disabled={loadingMore} className="btn-secondary" style={{ padding: '10px 18px' }}>
            {loadingMore
              ? <><Loader2 size={14} className="spin" /> Loading…</>
              : `Load ${Math.min(pageSize, total - customers.length)} more`}
          </button>
        </div>
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <style jsx global>{`
        .customers-mobile { display: none; }
        @media (max-width: 639px) {
          .customers-desktop { display: none; }
          .customers-mobile  { display: flex; flex-direction: column; }
        }
        .cust-card {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 12px 16px;
          background: var(--surface);
          border: none;
          border-bottom: 1px solid var(--border-soft);
          text-align: left;
          cursor: pointer;
          font-family: inherit;
          transition: background 100ms;
          width: 100%;
        }
        .cust-card:last-child { border-bottom: none; }
        .cust-card:active { background: var(--surface-2); }
        .cust-card__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cust-card__top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
        }
        .cust-card__name {
          flex: 1; min-width: 0;
          font-weight: 600; font-size: 14.5px;
          color: var(--ink);
          letter-spacing: -0.005em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cust-card__pts {
          flex-shrink: 0; white-space: nowrap;
        }
        .cust-card__meta {
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
          font-size: 12.5px; color: var(--ink-muted);
        }
        .cust-card__num {
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .cust-card__sep { opacity: 0.6; }
        .cust-card__city { font-size: 12.5px; color: var(--ink-muted); }
      `}</style>
    </div>
  );
}
