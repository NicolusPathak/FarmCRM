'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { Search, X, Plus, Save, Sparkles, Loader2 } from 'lucide-react';
import type { Customer, NewOrderItemForm, PaymentMethod } from '@/types';
import { PAYMENT_METHODS, PAYMENT_LABEL } from '@/types';
import { formatCurrency } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import toast from 'react-hot-toast';

interface Props { preselectedCustomer: Customer | null }

const BLANK: NewOrderItemForm = { item_name: '', quantity: 1, unit_price: 0 };

function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const ref      = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setResults([]); return; }
      const d = await res.json();
      setResults(d.customers ?? []);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(v), 240);
  };

  if (value) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <Avatar name={value.full_name} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{value.full_name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{value.customer_number} · {value.phone_number ?? 'No phone'}</div>
      </div>
      <button onClick={() => onChange(null)} className="btn-ghost" style={{ padding: 4 }}><X size={14} /></button>
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="search-bar">
        {loading
          ? <Loader2 size={16} className="spin" style={{ color: 'var(--ink-muted)' }} />
          : <Search size={16} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
        <input value={query} onChange={onInput} onFocus={() => { if (results.length) setOpen(true); }}
          placeholder="Search customer by name, phone, or number" />
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden' }}>
          {results.slice(0, 8).map(c => (
            <button key={c.id} onClick={() => { onChange(c); setQuery(''); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 100ms', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Avatar name={c.full_name} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{c.customer_number} · {c.phone_number}</div>
              </div>
              <span className="badge badge-neutral">{c.points_balance}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewOrderForm({ preselectedCustomer }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [customer,      setCustomer]      = useState<Customer | null>(preselectedCustomer);
  const [items,         setItems]         = useState<NewOrderItemForm[]>([{ ...BLANK }]);
  const [notes,         setNotes]         = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  const subtotal     = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const pointsEarned = Math.floor(subtotal);

  const updateItem = (idx: number, f: keyof NewOrderItemForm, v: string | number) =>
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [f]: v } : item));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!customer)                              { setError('Please select a customer.'); return; }
    if (items.some(i => !i.item_name.trim()))   { setError('All items need a name.'); return; }
    if (items.some(i => i.quantity <= 0))       { setError('Quantity must be greater than 0.'); return; }
    if (items.some(i => i.unit_price <= 0))     { setError('Price must be greater than $0.'); return; }
    setSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: customer.id, notes, items, payment_method: paymentMethod }) });
        const d   = await res.json();
        if (!res.ok) throw new Error(d.error ?? 'Failed');
        toast.success(`Order ${d.order_number} saved`);
        router.push(`/orders/${d.id}`);
      } catch (err: any) { setError(err.message); setSaving(false); }
    });
  }

  const th: React.CSSProperties = { padding: '10px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)', textAlign: 'left' };
  const td: React.CSSProperties = { padding: '6px 4px' };

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="label" style={{ marginBottom: 10 }}>Customer</div>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {customer && (
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)' }}>
                <div className="label">Current points</div>
                <div className="font-display" style={{ fontSize: 24, fontWeight: 400, marginTop: 2 }}>
                  {customer.points_balance.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink-muted)', fontFamily: 'inherit' }}>pts</span>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <label className="label" htmlFor="payment-method" style={{ marginBottom: 8 }}>Payment method</label>
            <select
              id="payment-method"
              className="input-field"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              style={{ appearance: 'auto' }}
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
              ))}
            </select>
          </div>

          <div className="card">
            <label className="label" style={{ marginBottom: 8 }}>Notes (optional)</label>
            <textarea className="input-field" rows={3} placeholder="Special instructions…" value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Items */}
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 14, letterSpacing: '-0.005em' }}>Items</div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <th style={th}>Item name</th>
                  <th style={{ ...th, width: 90 }}>Qty / lbs</th>
                  <th style={{ ...th, width: 110 }}>Unit price</th>
                  <th style={{ ...th, width: 100, textAlign: 'right' }}>Subtotal</th>
                  <th style={{ ...th, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td style={td}>
                      <input className="input-field" placeholder="e.g. Goat shoulder" value={item.item_name} onChange={e => updateItem(idx, 'item_name', e.target.value)} required />
                    </td>
                    <td style={td}>
                      <input className="input-field" type="number" min="0.001" step="0.001" placeholder="1" style={{ textAlign: 'center' }}
                        value={item.quantity || ''} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} required />
                    </td>
                    <td style={td}>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', fontSize: 13, fontWeight: 600 }}>$</span>
                        <input className="input-field" type="number" min="0" step="0.01" placeholder="0.00" style={{ paddingLeft: 24 }}
                          value={item.unit_price || ''} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} required />
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontSize: 14, paddingRight: 8, whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.quantity * item.unit_price)}
                    </td>
                    <td style={td}>
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems(p => p.filter((_, i) => i !== idx))}
                          className="btn-ghost" style={{ padding: '6px 6px' }}>
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button type="button" onClick={() => setItems(p => [...p, { ...BLANK }])}
              style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 12, border: '1px dashed var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--ink-muted)', fontFamily: 'inherit', transition: 'all 120ms', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ink)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <Plus size={14} /> Add item
            </button>
          </div>

          {/* Summary */}
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 14, letterSpacing: '-0.005em' }}>Summary</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--ink-muted)' }}>Subtotal ({items.length} item{items.length !== 1 ? 's' : ''})</span>
                <span style={{ fontWeight: 600 }}>{formatCurrency(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, alignItems: 'center' }}>
                <span style={{ color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} /> Points to earn</span>
                <span className="badge badge-neutral">+{pointsEarned}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
                <span className="font-display" style={{ fontSize: 24, fontWeight: 400 }}>{formatCurrency(subtotal)}</span>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 16, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, fontWeight: 500, border: '1px solid var(--danger-soft)' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '12px' }}>
                {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save order</>}
              </button>
              <button type="button" onClick={() => router.back()} className="btn-secondary" style={{ padding: '12px 18px' }}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
}
