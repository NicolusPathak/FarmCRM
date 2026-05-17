'use client';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { LoadingLink as Link, useLoadingAction } from '@/components/ui/GlobalLoading';
import Image from 'next/image';
import {
  Search, Plus, Pencil, Printer, X, Check, Ban, AlertOctagon, Lock,
  CheckCircle2, RefreshCw, ArrowLeftRight, Sparkles, Loader2,
} from 'lucide-react';
import type { Order, Customer, OrderLogEntry, PaymentMethod, SessionRole } from '@/types';
import { isAdminOrOwner } from '@/types';
import type { NewOrderItemForm } from '@/types';
import { PAYMENT_METHODS, PAYMENT_LABEL } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import toast from 'react-hot-toast';

const BLANK: NewOrderItemForm = { item_name: '', quantity: 1, unit_price: 0 };

const LOG_STYLES: Record<OrderLogEntry['type'], { color: string; bg: string; Icon: React.ComponentType<{ size?: number }> }> = {
  created:    { color: 'var(--success)', bg: 'var(--success-bg)', Icon: CheckCircle2 },
  modified:   { color: 'var(--ink-2)',   bg: 'var(--surface-2)',   Icon: RefreshCw },
  reassigned: { color: 'var(--warning)', bg: 'var(--warning-bg)',  Icon: ArrowLeftRight },
  voided:     { color: 'var(--danger)',  bg: 'var(--danger-bg)',   Icon: Ban },
};

// ── Inline customer search picker ──────────────────────────────
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
    debounce.current = setTimeout(() => search(v), 260);
  };

  if (value) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <Avatar name={value.full_name} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{value.full_name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{value.customer_number}</div>
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
          placeholder="Search for a customer" />
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden' }}>
          {results.slice(0, 8).map(c => (
            <button key={c.id} onClick={() => { onChange(c); setQuery(''); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Avatar name={c.full_name} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{c.customer_number}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main invoice view ───────────────────────────────────────────
interface Props { order: Order; role: SessionRole }

export default function InvoiceView({ order: init, role }: Props) {
  const isAdmin = isAdminOrOwner(role);
  const withLoading = useLoadingAction();
  const [order,          setOrder]         = useState(init);
  const [editing,        setEditing]       = useState(false);
  const [saving,         setSaving]        = useState(false);
  const [confirmVoid,    setConfirmVoid]   = useState(false);
  const [voiding,        setVoiding]       = useState(false);
  const [draftItems,     setDraftItems]    = useState<NewOrderItemForm[]>([]);
  const [draftNotes,     setDraftNotes]    = useState('');
  const [draftCustomer,  setDraftCustomer] = useState<Customer | null>(null);
  const [draftPayment,   setDraftPayment]  = useState<PaymentMethod>('cash');

  const customer  = (order as any).customer as Customer | undefined;
  const items     = order.order_items ?? [];
  const isVoid    = order.status === 'void';
  const customerArchived = !!customer?.archived_at;
  const changeLog = (order.change_log ?? []) as OrderLogEntry[];

  // 24-hour edit window — computed client-side only to avoid hydration mismatch
  const lockAt = useMemo(
    () => new Date(new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000),
    [order.created_at]
  );
  const [isEditable, setIsEditable] = useState(false);
  useEffect(() => {
    setIsEditable(!isVoid && Date.now() < lockAt.getTime());
  }, [isVoid, lockAt]);

  function startEdit() {
    setDraftItems(items.map(i => ({ item_name: i.item_name, quantity: i.quantity, unit_price: i.unit_price })));
    setDraftNotes(order.notes ?? '');
    setDraftCustomer(customer ?? null);
    setDraftPayment((order.payment_method ?? 'cash') as PaymentMethod);
    setEditing(true);
  }

  const updateItem = (idx: number, f: keyof NewOrderItemForm, v: string | number) =>
    setDraftItems(prev => prev.map((item, i) => i === idx ? { ...item, [f]: v } : item));

  const draftSubtotal = draftItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  async function saveEdit() {
    if (!draftCustomer)                              { toast.error('A customer is required.'); return; }
    if (draftItems.some(i => !i.item_name.trim()))   { toast.error('All items need a name.'); return; }
    if (draftItems.some(i => i.quantity <= 0))       { toast.error('Quantity must be greater than 0.'); return; }
    if (draftItems.some(i => i.unit_price <= 0))     { toast.error('Price must be greater than $0.'); return; }
    setSaving(true);
    await withLoading(async () => {
      try {
        // Only admins are allowed to change payment_method. Including the
        // field on a staff PATCH would 403 the whole edit; omit it for staff.
        const payload: Record<string, unknown> = {
          items: draftItems, notes: draftNotes, customer_id: draftCustomer.id,
        };
        if (isAdmin) payload.payment_method = draftPayment;
        const res = await fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
        setOrder(await res.json());
        setEditing(false);
        toast.success('Order updated');
      } catch (err: any) {
        toast.error(err.message);
      } finally { setSaving(false); }
    });
  }

  async function voidOrder() {
    setVoiding(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'void' }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Void failed');
        setOrder(await res.json());
        setConfirmVoid(false);
        toast.success(`Order ${order.order_number} voided`);
      } catch (err: any) {
        toast.error(err.message);
      } finally { setVoiding(false); }
    });
  }

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '10px 0', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)',
  };
  const tdEdit: React.CSSProperties = { padding: '6px 4px' };

  return (
    <div>
      <PageHeader
        title={order.order_number}
        subtitle={formatDateTime(order.order_date)}
        backHref={customer ? `/customers/${customer.id}` : '/orders'}
        backLabel={customer?.full_name ?? 'Orders'}
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {confirmVoid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--danger-bg)', padding: '7px 12px', borderRadius: 10, border: '1px solid var(--danger-soft)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 500 }}>
                  Void {order.order_number}? Reverses {order.points_earned} pts.
                </span>
                <button onClick={() => setConfirmVoid(false)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}>Cancel</button>
                <button onClick={voidOrder} disabled={voiding} className="btn-danger"
                  style={{ padding: '6px 12px', fontSize: 12, background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}>
                  {voiding ? <Loader2 size={12} className="spin" /> : 'Confirm'}
                </button>
              </div>
            ) : editing ? (
              <>
                <button onClick={() => setEditing(false)} className="btn-secondary"><X size={14} /> Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="btn-primary">
                  {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Check size={14} /> Save</>}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => window.print()} className="btn-secondary"><Printer size={14} /> Print</button>
                {!isVoid && isEditable && (
                  <button onClick={startEdit} className="btn-secondary"><Pencil size={14} /> Edit</button>
                )}
                {!isVoid && (
                  <button onClick={() => setConfirmVoid(true)} className="btn-danger">
                    <Ban size={14} /> Void
                  </button>
                )}
                {!isVoid && customer && (
                  <Link href={`/orders/new?customer=${customer.id}`} className="btn-primary"><Plus size={14} /> New order</Link>
                )}
              </>
            )}
          </div>
        }
      />

      <div style={{ maxWidth: 680 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Void banner */}
          {isVoid && (
            <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-soft)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertOctagon size={20} strokeWidth={1.8} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--danger)', fontSize: 14 }}>This order has been voided</div>
                <div style={{ fontSize: 13, color: 'var(--danger)', opacity: 0.85, marginTop: 2 }}>
                  Points have been reversed. Order number {order.order_number} is permanently reserved.
                </div>
              </div>
            </div>
          )}

          {/* Archived-customer warning — shown when the order's customer has
              been deleted. Edits still work but silently change a customer
              who's invisible everywhere else; the banner makes that clear. */}
          {!isVoid && customerArchived && (
            <div className="no-print" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertOctagon size={20} strokeWidth={1.8} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--warning)', fontSize: 14 }}>
                  This customer has been deleted
                </div>
                <div style={{ fontSize: 13, color: 'var(--warning)', opacity: 0.9, marginTop: 2 }}>
                  Editing this order will still adjust {customer?.full_name ?? 'their'} points balance,
                  even though they no longer appear in the Customers list. Reassign the order to an
                  active customer if you want changes to be visible.
                </div>
              </div>
            </div>
          )}

          {/* Invoice header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 22, borderBottom: '1px solid var(--border)', opacity: isVoid ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 64, height: 64, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 6, boxShadow: 'var(--shadow-sm)' }}>
                <Image src="/logo.png" alt="Chaudhary Farm" width={52} height={52} style={{ objectFit: 'contain' }} />
              </div>
              <div>
                <div className="font-display" style={{ fontWeight: 400, fontSize: 19 }}>Chaudhary Farm</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>Haslet, TX</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="label">Invoice</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <div className="font-display" style={{ fontSize: 24, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{order.order_number}</div>
                {isVoid && <span className="badge badge-danger" style={{ letterSpacing: '0.08em' }}>VOID</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{formatDateTime(order.order_date)}</div>
            </div>
          </div>

          {/* Bill to */}
          <div style={{ opacity: isVoid ? 0.5 : 1 }}>
            <div className="label" style={{ marginBottom: 8 }}>Bill To</div>
            {editing ? (
              <CustomerPicker value={draftCustomer} onChange={setDraftCustomer} />
            ) : customer ? (
              <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--warm-gray)' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{customer.full_name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{customer.customer_number}</div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>—</div>
            )}
          </div>

          {/* Payment method — hidden entirely on voided orders. */}
          {!isVoid && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Payment</div>
              {editing && isAdmin ? (
                <select
                  className="input-field"
                  value={draftPayment}
                  onChange={(e) => setDraftPayment(e.target.value as PaymentMethod)}
                  style={{ appearance: 'auto', maxWidth: 220 }}
                >
                  {PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  Payment: {PAYMENT_LABEL[(order.payment_method ?? 'cash') as PaymentMethod]}
                </div>
              )}
            </div>
          )}

          {/* Items */}
          <div style={{ opacity: isVoid ? 0.5 : 1 }}>
            {editing ? (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={th}>Item</th>
                      <th style={{ ...th, width: 90, textAlign: 'center' }}>Qty / lbs</th>
                      <th style={{ ...th, width: 110, textAlign: 'right' }}>Unit Price</th>
                      <th style={{ ...th, width: 100, textAlign: 'right' }}>Total</th>
                      <th style={{ ...th, width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={tdEdit}>
                          <input className="input-field" placeholder="e.g. Ribeye Steak" value={item.item_name}
                            onChange={e => updateItem(idx, 'item_name', e.target.value)} />
                        </td>
                        <td style={tdEdit}>
                          <input className="input-field" type="number" min="0.001" step="0.001" style={{ textAlign: 'center' }}
                            value={item.quantity || ''} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                        </td>
                        <td style={tdEdit}>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>$</span>
                            <input className="input-field" type="number" min="0" step="0.01" style={{ paddingLeft: 24 }}
                              value={item.unit_price || ''} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                          </div>
                        </td>
                        <td style={{ ...tdEdit, textAlign: 'right', fontWeight: 600, fontSize: 14, paddingRight: 8, whiteSpace: 'nowrap' }}>
                          {formatCurrency(item.quantity * item.unit_price)}
                        </td>
                        <td style={tdEdit}>
                          {draftItems.length > 1 && (
                            <button type="button" onClick={() => setDraftItems(p => p.filter((_, i) => i !== idx))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '8px 6px', borderRadius: 8, transition: 'all 100ms' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--red-light)'; (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button type="button" onClick={() => setDraftItems(p => [...p, { ...BLANK }])}
                  style={{ marginTop: 10, width: '100%', padding: '10px', borderRadius: 10, border: '1.5px dashed var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'inherit', transition: 'all 120ms' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--red)'; (e.currentTarget as HTMLElement).style.color = 'var(--red)'; (e.currentTarget as HTMLElement).style.background = 'var(--red-light)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  + Add Item
                </button>

                <div style={{ marginTop: 16 }}>
                  <label className="label" style={{ marginBottom: 6, display: 'block' }}>Notes</label>
                  <textarea className="input-field" rows={2} placeholder="Special instructions…" value={draftNotes}
                    onChange={e => setDraftNotes(e.target.value)} style={{ resize: 'none' }} />
                </div>

                <div style={{ borderTop: '2px solid var(--border)', paddingTop: 14, marginTop: 14, maxWidth: 240, marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(draftSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, alignItems: 'center' }}>
                    <span style={{ color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} /> Points to earn</span>
                    <span className="badge badge-neutral">+{Math.floor(draftSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
                    <span className="font-display" style={{ fontSize: 22, fontWeight: 400 }}>{formatCurrency(draftSubtotal)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={th}>Item</th>
                      <th style={{ ...th, textAlign: 'center', width: 80 }}>Qty</th>
                      <th style={{ ...th, textAlign: 'right', width: 110 }}>Unit Price</th>
                      <th style={{ ...th, textAlign: 'right', width: 110 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '14px 0', fontWeight: 500, fontSize: 14 }}>{item.item_name}</td>
                        <td style={{ padding: '14px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                          {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(3)}
                        </td>
                        <td style={{ padding: '14px 12px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 14 }}>{formatCurrency(item.unit_price)}</td>
                        <td style={{ padding: '14px 0', textAlign: 'right', fontWeight: 600, fontSize: 14 }}>{formatCurrency(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totals (view mode) */}
          {!editing && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, opacity: isVoid ? 0.5 : 1 }}>
              <div style={{ maxWidth: 260, marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--ink-muted)' }}>Subtotal</span>
                  <span style={{ fontWeight: 600, textDecoration: isVoid ? 'line-through' : 'none' }}>{formatCurrency(order.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, alignItems: 'center' }}>
                  <span style={{ color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} /> Points {isVoid ? 'reversed' : 'earned'}</span>
                  <span className="badge badge-neutral" style={{ opacity: isVoid ? 0.5 : 1 }}>{isVoid ? '-' : '+'}{order.points_earned}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
                  <span className="font-display" style={{ fontSize: 26, fontWeight: 400, color: isVoid ? 'var(--ink-muted)' : 'var(--ink)', textDecoration: isVoid ? 'line-through' : 'none' }}>{formatCurrency(order.total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes (view mode) */}
          {!editing && order.notes && (
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-soft)', opacity: isVoid ? 0.5 : 1 }}>
              <div className="label" style={{ marginBottom: 6 }}>Notes</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{order.notes}</p>
            </div>
          )}

          {/* Edit window status (active orders only) */}
          {!editing && !isVoid && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-muted)', padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              {isEditable
                ? <><Pencil size={12} /> Editable until {formatDateTime(lockAt.toISOString())}</>
                : <><Lock size={12} /> Edit window closed {formatDate(lockAt.toISOString())}</>}
            </div>
          )}

          {/* Change log */}
          {changeLog.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
              <div style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Order history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {changeLog.map((entry, i) => {
                  const style = LOG_STYLES[entry.type] ?? LOG_STYLES.modified;
                  const Icon = style.Icon;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: style.bg, color: style.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <Icon size={12} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{entry.summary}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{formatDateTime(entry.timestamp)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ textAlign: 'center', paddingTop: 8, borderTop: '1px solid var(--border-soft)', fontSize: 12.5, color: 'var(--ink-muted)' }}>
            Thank you for your business · Chaudhary Farm · Haslet, TX
          </div>

        </div>
      </div>
      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
