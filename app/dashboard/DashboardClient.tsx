'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { LoadingLink as Link, useLoadingRouter } from '@/components/ui/GlobalLoading';
import Image from 'next/image';
import { Search, X, Plus, UserPlus, Receipt, Users, ArrowRight, Loader2 } from 'lucide-react';
import type { DashboardStats } from '@/lib/db';
import type { Customer, Order, SessionRole } from '@/types';
import { isAdminOrOwner } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

interface Props { stats: DashboardStats; role: SessionRole }

function StatCard({ label, value, sub, Icon }: { label: string; value: string; sub?: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={18} strokeWidth={1.8} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardClient({ stats, role }: Props) {
  const isAdmin = isAdminOrOwner(role);
  const router = useLoadingRouter();
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDrop,  setShowDrop]  = useState(false);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setResults([]); setShowDrop(true); return; }
      const d = await res.json();
      setResults(d.customers ?? []);
      setShowDrop(true);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (!v.trim()) { setResults([]); setShowDrop(false); return; }
    debounce.current = setTimeout(() => doSearch(v), 240);
  };

  const pick = (id: string) => { setShowDrop(false); setQuery(''); router.push(`/customers/${id}`); };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 28 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18, background: 'var(--surface)',
          border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 8, flexShrink: 0, boxShadow: 'var(--shadow-sm)',
        }}>
          <Image src="/logo.png" alt="Chaudhary Farm" width={56} height={56} priority style={{ objectFit: 'contain' }} />
        </div>
        <div>
          <h1 className="font-display" style={{ fontSize: 32, fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
            Chaudhary Farm
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)', marginTop: 4 }}>
            Snapshot of the shop and a quick search across all customers.
          </p>
        </div>
      </div>

      {/* Sales at a glance — admin-only (revenue is shop financial data).
          Responsive collapse-to-2x2 rule lives in the bottom <style jsx>. */}
      {isAdmin && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 28,
        }} className="sales-glance">
          <Glance label="Today"      value={stats.today_revenue}      n={stats.today_order_count} />
          <Glance label="Yesterday"  value={stats.yesterday_revenue}  n={stats.yesterday_order_count} />
          <Glance label="This week"  value={stats.this_week_revenue}  n={stats.this_week_order_count} />
          <Glance label="This month" value={stats.this_month_revenue} n={stats.this_month_order_count} />
        </div>
      )}

      {/* Search */}
      <div ref={wrapRef} style={{ position: 'relative', marginBottom: 24 }}>
        <div className="search-bar" style={{ padding: '14px 18px' }}>
          {searching
            ? <Loader2 size={18} strokeWidth={2} className="spin" style={{ color: 'var(--ink-muted)' }} />
            : <Search size={18} strokeWidth={2} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
          <input
            value={query} onChange={onInput}
            onFocus={() => { if (results.length) setShowDrop(true); }}
            placeholder="Search customers by name, phone, customer #, city, street, or ZIP"
            style={{ fontSize: 15 }}
            autoComplete="off"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setShowDrop(false); }}
              className="btn-ghost" style={{ padding: '4px 8px' }}>
              <X size={14} />
            </button>
          )}
        </div>

        {showDrop && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, boxShadow: 'var(--shadow-lg)',
            zIndex: 50, overflow: 'hidden',
          }}>
            {results.length > 0 ? (
              <>
                <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)' }}>
                  {results.length} match{results.length !== 1 ? 'es' : ''}
                </div>
                {results.map(c => (
                  <button key={c.id} onClick={() => pick(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'background 100ms' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Avatar name={c.full_name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.full_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{c.customer_number} · {c.phone_number ?? 'No phone'}</div>
                    </div>
                    <span className="badge badge-neutral">{c.points_balance} pts</span>
                  </button>
                ))}
              </>
            ) : (
              <div style={{ padding: '28px 24px', textAlign: 'center' }}>
                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No matches</p>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>Nothing matches “{query}”</p>
                <Link href="/customers/new" className="btn-primary" onClick={() => setShowDrop(false)} style={{ fontSize: 13 }}>
                  <UserPlus size={14} /> Create new customer
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 32, flexWrap: 'wrap' }}>
        <Link href="/orders/new" className="btn-primary"><Plus size={15} /> New order</Link>
        <Link href="/customers/new" className="btn-secondary"><UserPlus size={15} /> New customer</Link>
        <Link href="/customers" className="btn-secondary"><Users size={15} /> All customers</Link>
      </div>

      {/* Stats — Lifetime sales is admin-only. Staff see a 2-column grid. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isAdmin ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
        gap: 14,
        marginBottom: 28,
      }}>
        <StatCard label="Customers" value={stats.totalCustomers.toLocaleString()} Icon={Users} />
        <StatCard label="Orders"    value={stats.totalOrders.toLocaleString()}    Icon={Receipt} />
        {isAdmin && (
          <StatCard label="Lifetime sales" value={formatCurrency(stats.totalRevenue)} Icon={Receipt} />
        )}
      </div>

      {/* Recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        <Panel
          title="Recent customers"
          actionHref="/customers"
          actionLabel="All customers"
          empty={stats.recentCustomers.length === 0 ? 'No customers yet' : null}
        >
          {stats.recentCustomers.map(c => (
            <PanelRow key={c.id} href={`/customers/${c.id}`}>
              <Avatar name={c.full_name} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{c.customer_number}</div>
              </div>
              <span className="badge badge-neutral">{c.points_balance} pts</span>
            </PanelRow>
          ))}
        </Panel>

        <Panel
          title="Recent orders"
          actionHref="/orders"
          actionLabel="All orders"
          empty={stats.recentOrders.length === 0 ? 'No orders yet' : null}
        >
          {stats.recentOrders.map((o: Order) => (
            <PanelRow key={o.id} href={`/orders/${o.id}`}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Receipt size={16} strokeWidth={1.8} style={{ color: 'var(--ink-2)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(o as any).customer?.full_name ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{o.order_number} · {formatDate(o.order_date)}</div>
              </div>
              <span style={{ fontWeight: 600, fontSize: 14, flexShrink: 0, textDecoration: o.status === 'void' ? 'line-through' : 'none', color: o.status === 'void' ? 'var(--ink-muted)' : 'inherit' }}>{formatCurrency(o.total)}</span>
            </PanelRow>
          ))}
        </Panel>
      </div>

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 720px) {
          :global(.sales-glance) { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function Panel({ title, actionHref, actionLabel, empty, children }: { title: string; actionHref: string; actionLabel: string; empty?: string | null; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border-soft)' }}>
        <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.005em' }}>{title}</span>
        <Link href={actionHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', textDecoration: 'none' }}>
          {actionLabel} <ArrowRight size={12} />
        </Link>
      </div>
      {empty
        ? <p style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--ink-muted)', fontSize: 13.5 }}>{empty}</p>
        : children}
    </div>
  );
}

function PanelRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', textDecoration: 'none', color: 'inherit', borderBottom: '1px solid var(--border-soft)', transition: 'background 100ms' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {children}
    </Link>
  );
}

/** One stat card for the "Sales at a glance" row: large USD value + small "N orders" subtext. */
function Glance({ label, value, n }: { label: string; value: number; n: number }) {
  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="font-display" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
        {formatCurrency(value)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        {n} order{n === 1 ? '' : 's'}
      </div>
    </div>
  );
}
