'use client';
import { useState, useRef, useCallback } from 'react';
import { useLoadingRouter } from '@/components/ui/GlobalLoading';
import { Search, X, Receipt, Loader2 } from 'lucide-react';
import type { Order } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';

interface Props {
  orders: Order[];
  total: number;
  pageSize: number;
}

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateFilter(from: string, to: string): boolean {
  if (!from && !to) return true;
  if (from && !YYYY_MM_DD.test(from)) return false;
  if (to   && !YYYY_MM_DD.test(to))   return false;
  if (from && to && from > to) return false;
  return true;
}

export default function OrdersClient({ orders: initial, total: initialTotal, pageSize }: Props) {
  const router = useLoadingRouter();
  const [query,   setQuery]   = useState('');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [orders,  setOrders]  = useState<Order[]>(initial);
  const [total,   setTotal]   = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter so a stale fetch (slow earlier request landing after a
  // faster later one) can't overwrite the current view.
  const requestSeq = useRef(0);

  // Browse mode (no search query): paginated via /api/orders, honors date
  // filter, supports "Load more".
  const loadBrowse = useCallback(async (opts: {
    from?: string; to?: string; reset?: boolean;
  }) => {
    const myReq = ++requestSeq.current;
    const fr = opts.from ?? from;
    const tr = opts.to   ?? to;
    const setBusy = opts.reset ? setLoading : setLoadingMore;
    setBusy(true);
    try {
      const offset = opts.reset ? 0 : orders.length;
      const url = new URL('/api/orders', window.location.origin);
      url.searchParams.set('limit',  String(pageSize));
      url.searchParams.set('offset', String(offset));
      if (fr) url.searchParams.set('from', fr);
      if (tr) url.searchParams.set('to',   tr);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (myReq !== requestSeq.current) return;
      const incoming = (d.orders ?? []) as Order[];
      setOrders((prev) => opts.reset ? incoming : [...prev, ...incoming]);
      setTotal(d.total ?? 0);
    } catch {
      if (myReq !== requestSeq.current) return;
      if (opts.reset) { setOrders([]); setTotal(0); }
    } finally {
      if (myReq === requestSeq.current) setBusy(false);
    }
  }, [from, to, orders.length, pageSize]);

  // Search mode: hit /api/orders/search with the query + date range. Search
  // returns up to its own limit (no offset pagination — search results are
  // for finding, not browsing). Date filter still applies so a search like
  // "ribeye" within March 2025 actually scopes both axes.
  const doSearch = useCallback(async (q: string, fr: string, tr: string) => {
    const myReq = ++requestSeq.current;
    setLoading(true);
    try {
      const url = new URL('/api/orders/search', window.location.origin);
      url.searchParams.set('q', q);
      if (fr) url.searchParams.set('from', fr);
      if (tr) url.searchParams.set('to',   tr);
      const res = await fetch(url.toString());
      if (!res.ok) { if (myReq === requestSeq.current) { setOrders([]); setTotal(0); } return; }
      const d = await res.json();
      if (myReq !== requestSeq.current) return;
      const incoming = (d.orders ?? []) as Order[];
      setOrders(incoming);
      // Search doesn't return a total; we present "n found" instead.
      setTotal(incoming.length);
    } catch {
      if (myReq === requestSeq.current) { setOrders([]); setTotal(0); }
    } finally {
      if (myReq === requestSeq.current) setLoading(false);
    }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (v.trim()) doSearch(v, from, to);
      else          loadBrowse({ reset: true });
    }, 240);
  };

  function clearQuery() {
    setQuery('');
    if (debounce.current) clearTimeout(debounce.current);
    loadBrowse({ reset: true });
  }

  function changeFrom(next: string) {
    setFrom(next);
    if (!isValidDateFilter(next, to)) return;
    if (query.trim()) doSearch(query, next, to);
    else              loadBrowse({ from: next, reset: true });
  }

  function changeTo(next: string) {
    setTo(next);
    if (!isValidDateFilter(from, next)) return;
    if (query.trim()) doSearch(query, from, next);
    else              loadBrowse({ to: next, reset: true });
  }

  function clearDates() {
    setFrom(''); setTo('');
    if (query.trim()) doSearch(query, '', '');
    else              loadBrowse({ from: '', to: '', reset: true });
  }

  const inSearch       = query.trim().length > 0;
  const dateRangeOk    = isValidDateFilter(from, to);
  const hasDateFilter  = Boolean(from || to);
  const canLoadMore    = !inSearch && orders.length < total;

  return (
    <div>
      <div className="search-bar" style={{ marginBottom: 12 }}>
        {loading
          ? <Loader2 size={16} strokeWidth={2} className="spin" style={{ color: 'var(--ink-muted)' }} />
          : <Search size={16} strokeWidth={2} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
        <input value={query} onChange={onInput}
          placeholder="Search by order #, customer name, phone, item, or notes" />
        {query && (
          <button onClick={clearQuery} className="btn-ghost" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Date range filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
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

      {orders.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState Icon={Receipt}
            title={query ? 'No matching orders' : 'No orders yet'}
            description={query ? `Nothing matches “${query}”.` : 'Create your first order to get started.'}
            actionLabel="New order" actionHref="/orders/new" />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Desktop / tablet table */}
          <table className="data-table orders-desktop">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Points</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const cust   = (o as any).customer;
                const voided = o.status === 'void';
                return (
                  <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}>{o.order_number}</span>
                        {voided && <span className="badge badge-danger" style={{ letterSpacing: '0.08em' }}>VOID</span>}
                      </div>
                    </td>
                    <td>
                      <div className="cust-cell">
                        <div className="cust-cell__row">
                          <span className="cust-cell__name" style={{ opacity: voided ? 0.55 : 1 }}>
                            {cust?.full_name ?? '—'}
                          </span>
                          {cust?.phone_number && (
                            <span className="cust-cell__phone" title={cust.phone_number}>
                              {cust.phone_number}
                            </span>
                          )}
                        </div>
                        {cust?.customer_number && (
                          <div className="cust-cell__num">{cust.customer_number}</div>
                        )}
                      </div>
                    </td>
                    <td style={{ color: 'var(--ink-2)' }}>{formatDate(o.order_date)}</td>
                    <td>
                      {voided
                        ? <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>
                        : <span className="badge badge-neutral">+{o.points_earned}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, textDecoration: voided ? 'line-through' : 'none', color: voided ? 'var(--ink-muted)' : 'inherit' }}>
                      {formatCurrency(o.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile card list — shown < 640px; same data, stacked. The whole
              card is a tap target so staff can thumb-tap to drill in. */}
          <div className="orders-mobile">
            {orders.map(o => {
              const cust   = (o as any).customer;
              const voided = o.status === 'void';
              return (
                <button
                  key={o.id}
                  type="button"
                  className="order-card"
                  onClick={() => router.push(`/orders/${o.id}`)}
                >
                  <div className="order-card__row">
                    <div className="order-card__left">
                      <span className="order-card__num">{o.order_number}</span>
                      {voided && <span className="badge badge-danger" style={{ letterSpacing: '0.08em' }}>VOID</span>}
                    </div>
                    {!voided && (
                      <span className="badge badge-neutral" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>+{o.points_earned} pts</span>
                    )}
                  </div>
                  <div className="order-card__name" style={{ opacity: voided ? 0.55 : 1 }}>
                    {cust?.full_name ?? '—'}
                    {cust?.phone_number && <span className="order-card__phone">{cust.phone_number}</span>}
                  </div>
                  {cust?.customer_number && (
                    <div className="order-card__custnum">{cust.customer_number}</div>
                  )}
                  <div className="order-card__row" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{formatDate(o.order_date)}</span>
                    <span style={{
                      fontWeight: 700, fontSize: 15,
                      textDecoration: voided ? 'line-through' : 'none',
                      color: voided ? 'var(--ink-muted)' : 'var(--ink)',
                    }}>{formatCurrency(o.total)}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--ink-muted)' }}>
            {inSearch
              ? `${orders.length} order${orders.length !== 1 ? 's' : ''} matching "${query}"`
              : `Showing ${orders.length} of ${total} order${total !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}

      {canLoadMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => loadBrowse({})} disabled={loadingMore} className="btn-secondary" style={{ padding: '10px 18px' }}>
            {loadingMore
              ? <><Loader2 size={14} className="spin" /> Loading…</>
              : `Load ${Math.min(pageSize, total - orders.length)} more`}
          </button>
        </div>
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <style jsx global>{`
        /* Two-row customer cell: name + phone-pill on the first row, the
           internal customer # on the second. Phone sits on the right as a
           subtle pill so it reads as metadata, not as a competing primary.
           Phone-pill stays a single line; name truncates if the row is
           tight, so the pill remains visible. */
        .cust-cell {
          display: flex; flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .cust-cell__row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
          min-width: 0;
        }
        .cust-cell__name {
          flex: 1; min-width: 0;
          font-weight: 600;
          font-size: 14px;
          color: var(--ink);
          letter-spacing: -0.005em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cust-cell__phone {
          flex-shrink: 0;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px;
          font-weight: 500;
          color: var(--ink-2);
          background: var(--surface-2);
          padding: 3px 9px;
          border-radius: 999px;
          border: 1px solid var(--border-soft);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .cust-cell__num {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px;
          color: var(--ink-muted);
        }
        /* Narrow phones: drop the pill on a new line under the name so
           neither piece truncates awkwardly. */
        @media (max-width: 520px) {
          .cust-cell__row {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .cust-cell__phone { align-self: flex-start; }
        }

        /* ─── Desktop table ↔ mobile card-list switch ─────────────────
           The table reads great with mouse + room to breathe (≥ 640px).
           Below that we hide the table entirely and use a stacked card
           layout where each card is one whole tap target — no sideways
           swipe required. */
        .orders-mobile { display: none; }
        @media (max-width: 639px) {
          .orders-desktop { display: none; }
          .orders-mobile  { display: flex; flex-direction: column; }
        }
        .order-card {
          display: flex; flex-direction: column; gap: 4px;
          padding: 14px 16px;
          background: var(--surface);
          border: none;
          border-bottom: 1px solid var(--border-soft);
          text-align: left;
          cursor: pointer;
          font-family: inherit;
          transition: background 100ms;
          width: 100%;
        }
        .order-card:last-child { border-bottom: none; }
        .order-card:active { background: var(--surface-2); }
        .order-card__row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
        }
        .order-card__left {
          display: inline-flex; align-items: center; gap: 8px;
          min-width: 0;
        }
        .order-card__num {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13px; font-weight: 700;
          color: var(--ink);
        }
        .order-card__name {
          display: flex; align-items: baseline; gap: 8px;
          flex-wrap: wrap;
          font-weight: 600; font-size: 14.5px;
          color: var(--ink);
          margin-top: 2px;
          letter-spacing: -0.005em;
        }
        .order-card__phone {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px; font-weight: 500;
          color: var(--ink-2);
          background: var(--surface-2);
          padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--border-soft);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .order-card__custnum {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px; color: var(--ink-muted);
        }
      `}</style>
    </div>
  );
}
