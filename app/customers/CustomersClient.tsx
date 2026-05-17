'use client';
import { useState, useRef, useCallback } from 'react';
import { useLoadingRouter } from '@/components/ui/GlobalLoading';
import { Search, X, Users, Loader2 } from 'lucide-react';
import type { Customer } from '@/types';
import { formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';

export default function CustomersClient({ customers: initial, initialQuery }: { customers: Customer[]; initialQuery: string }) {
  const router = useLoadingRouter();
  const [query,     setQuery]     = useState(initialQuery);
  const [customers, setCustomers] = useState(initial);
  const [loading,   setLoading]   = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setCustomers([]); return; }
      const d = await res.json();
      setCustomers(d.customers ?? []);
    } catch { setCustomers([]); }
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
        <input value={query} onChange={onInput} placeholder="Search by name, phone, customer #, city, street, or ZIP" autoFocus={!!initialQuery} />
        {query && (
          <button onClick={() => { setQuery(''); doSearch(''); }} className="btn-ghost" style={{ padding: '4px 8px' }}>
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
          <table className="data-table">
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
                  <td><span className="badge badge-neutral">{c.points_balance}</span></td>
                  <td style={{ color: 'var(--ink-muted)' }}>{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--ink-muted)' }}>
            {customers.length} customer{customers.length !== 1 ? 's' : ''}
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
