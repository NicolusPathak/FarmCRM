'use client';
import { useState, useRef, useCallback } from 'react';
import { useLoadingRouter } from '@/components/ui/GlobalLoading';
import { Search, X, Receipt, Loader2 } from 'lucide-react';
import type { Order } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';

export default function OrdersClient({ orders: initial }: { orders: Order[] }) {
  const router = useLoadingRouter();
  const [query,   setQuery]   = useState('');
  const [orders,  setOrders]  = useState<Order[]>(initial);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hit the server every keystroke (debounced) so we can find orders older
  // than the initial 50 we were handed at mount time. Client-side filtering
  // would silently lie about anything past the window.
  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setOrders([]); return; }
      const d = await res.json();
      setOrders(d.orders ?? []);
    } catch { setOrders([]); }
    finally { setLoading(false); }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => doSearch(v), 240);
  };

  return (
    <div>
      <div className="search-bar" style={{ marginBottom: 18 }}>
        {loading
          ? <Loader2 size={16} strokeWidth={2} className="spin" style={{ color: 'var(--ink-muted)' }} />
          : <Search size={16} strokeWidth={2} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
        <input value={query} onChange={onInput}
          placeholder="Search by order #, customer name, phone, item, or notes" />
        {query && (
          <button onClick={() => { setQuery(''); doSearch(''); }} className="btn-ghost" style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
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
          <table className="data-table">
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
                      <div style={{ fontWeight: 600, opacity: voided ? 0.55 : 1 }}>{cust?.full_name ?? '—'}</div>
                      {cust?.customer_number && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{cust.customer_number}</div>}
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
          <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--ink-muted)' }}>
            {orders.length} order{orders.length !== 1 ? 's' : ''}{query ? ` matching “${query}”` : ''}
          </div>
        </div>
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
