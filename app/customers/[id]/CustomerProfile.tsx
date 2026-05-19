'use client';
import { useState } from 'react';
import { LoadingLink as Link, useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { Pencil, Plus, Trash2, Check, X, Sparkles, ShoppingBag, BarChart3, DollarSign, Loader2 } from 'lucide-react';
import type { Customer, Order, SessionRole } from '@/types';
import { isAdminOrOwner } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/layout/PageHeader';
import toast from 'react-hot-toast';

interface Props { customer: Customer; orders: Order[]; role: SessionRole }

function Row({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="label" style={{ marginBottom: 3 }}>{label}</div>
      {children ?? <div style={{ fontSize: 14, fontWeight: 500 }}>{value || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>}
    </div>
  );
}

export default function CustomerProfile({ customer: init, orders, role }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [customer, setCustomer] = useState(init);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [draft,    setDraft]    = useState({ ...init });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  // Inline points-adjust state. Admin types a signed delta + reason; the
  // server validates the resulting balance stays >= 0.
  const [adjusting,    setAdjusting]    = useState(false);
  const [adjustDelta,  setAdjustDelta]  = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const isAdmin = isAdminOrOwner(role);

  async function commitAdjust() {
    const delta = parseInt(adjustDelta, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      toast.error('Enter a positive or negative whole number.');
      return;
    }
    setAdjustSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/customers/${customer.id}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delta, reason: adjustReason.trim() || undefined }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Adjustment failed');
        const data = await res.json();
        setCustomer(c => ({ ...c, points_balance: data.points_balance }));
        setAdjusting(false); setAdjustDelta(''); setAdjustReason('');
        toast.success(delta > 0 ? `Added ${delta} points` : `Deducted ${-delta} points`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setAdjustSaving(false);
      }
    });
  }

  function cancelAdjust() {
    setAdjusting(false); setAdjustDelta(''); setAdjustReason(''); setAdjustSaving(false);
  }

  async function deleteCustomer() {
    setDeleting(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/customers/${customer.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
        toast.success(`${customer.full_name} removed`);
        router.push('/customers');
      } catch (err: any) {
        toast.error(err.message);
        setDeleting(false);
        setConfirmDelete(false);
      }
    });
  }

  const activeOrders = orders.filter(o => o.status !== 'void');
  const totalSpent   = activeOrders.reduce((s, o) => s + o.total, 0);
  const address      = [customer.street, customer.city, customer.zip_code].filter(Boolean).join(', ');

  async function saveEdit() {
    setSaving(true);
    await withLoading(async () => {
      try {
        // Only send the editable fields. The full `draft` carries
        // points_balance + customer_number which the API rejects (and
        // produces the "field cannot be edited here" error users saw).
        const payload = {
          full_name:    draft.full_name,
          phone_number: draft.phone_number,
          street:       draft.street,
          city:         draft.city,
          zip_code:     draft.zip_code,
        };
        const res = await fetch(`/api/customers/${customer.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
        setCustomer(await res.json());
        setEditing(false);
        toast.success('Customer updated');
      } catch (err: any) {
        toast.error(err.message);
      } finally { setSaving(false); }
    });
  }

  return (
    <div>
      <PageHeader
        title={customer.full_name}
        subtitle={customer.customer_number}
        backHref="/customers"
        backLabel="All Customers"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {confirmDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--danger-bg)', padding: '7px 12px', borderRadius: 10, border: '1px solid var(--danger-soft)' }}>
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>Delete {customer.full_name}?</span>
                <button onClick={() => setConfirmDelete(false)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}>Cancel</button>
                <button onClick={deleteCustomer} disabled={deleting} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12, background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}>
                  {deleting ? <Loader2 size={12} className="spin" /> : 'Confirm'}
                </button>
              </div>
            ) : editing ? (
              <>
                <button onClick={() => { setDraft({ ...customer }); setEditing(false); }} className="btn-secondary"><X size={14} /> Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="btn-primary">
                  {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Check size={14} /> Save</>}
                </button>
              </>
            ) : (
              <>
                {isAdmin && (
                  <button onClick={() => setConfirmDelete(true)} className="btn-danger">
                    <Trash2 size={14} /> Delete
                  </button>
                )}
                <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button>
                <Link href={`/orders/new?customer=${customer.id}`} className="btn-primary"><Plus size={14} /> New order</Link>
              </>
            )}
          </div>
        }
      />

      <div className="split-grid split-grid--narrow">

        {/* Left: profile */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Identity card */}
          <div className="card">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingBottom: 20, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
              <Avatar name={customer.full_name} size="lg" />
              <div style={{ marginTop: 12 }}>
                {editing ? (
                  <input className="input-field" value={draft.full_name} onChange={e => setDraft(d => ({ ...d, full_name: e.target.value }))} style={{ textAlign: 'center', fontWeight: 700 }} />
                ) : (
                  <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.2, fontFamily: "var(--font-dm-serif), serif" }}>{customer.full_name}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>{customer.customer_number}</div>
              </div>
            </div>

            <div>
              <Row label="Phone">
                {editing
                  ? <input className="input-field" value={draft.phone_number ?? ''} onChange={e => setDraft(d => ({ ...d, phone_number: e.target.value }))} placeholder="(817) 555-0101" type="tel" style={{ marginTop: 4 }} />
                  : <div style={{ fontSize: 14, fontWeight: 500 }}>{customer.phone_number || <span style={{ color: 'var(--text-muted)' }}>Not on file</span>}</div>
                }
              </Row>
              <Row label="Address">
                {editing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <input className="input-field" value={draft.street ?? ''} onChange={e => setDraft(d => ({ ...d, street: e.target.value }))} placeholder="Street" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
                      <input className="input-field" value={draft.city ?? ''} onChange={e => setDraft(d => ({ ...d, city: e.target.value }))} placeholder="City" />
                      <input className="input-field" value={draft.zip_code ?? ''} onChange={e => setDraft(d => ({ ...d, zip_code: e.target.value }))} placeholder="ZIP" />
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{address || <span style={{ color: 'var(--text-muted)' }}>Not on file</span>}</div>
                )}
              </Row>
              <div style={{ padding: '12px 0' }}>
                <div className="label" style={{ marginBottom: 3 }}>Member Since</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{formatDate(customer.created_at)}</div>
              </div>
            </div>
          </div>

          {/* Points card */}
          <div className="points-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(237,230,216,0.55)', marginBottom: 6 }}>Points balance</div>
                <div className="font-display" style={{ fontSize: 40, fontWeight: 400, color: 'var(--sidebar-text)', lineHeight: 1 }}>{customer.points_balance.toLocaleString()}</div>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(237,230,216,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand)' }}>
                <Sparkles size={18} strokeWidth={1.8} />
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(237,230,216,0.1)', paddingTop: 12, fontSize: 11.5, color: 'rgba(237,230,216,0.55)' }}>
              $1 spent · 1 point
            </div>

            {/* Adjust-points UI — admin only. Type a signed integer; +50
                credits, -100 deducts. Server validates the new balance can't
                go negative. */}
            {isAdmin && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(237,230,216,0.1)' }}>
                {adjusting ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="number"
                      step="1"
                      autoFocus
                      value={adjustDelta}
                      onChange={(e) => setAdjustDelta(e.target.value)}
                      placeholder="+50 or -100"
                      disabled={adjustSaving}
                      style={{
                        padding: '8px 10px', fontSize: 14,
                        background: 'rgba(237,230,216,0.08)',
                        border: '1px solid rgba(237,230,216,0.18)',
                        borderRadius: 8, color: 'var(--sidebar-text)',
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                    />
                    <input
                      type="text"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="Reason (e.g. $5 off — 100 pts redeemed)"
                      disabled={adjustSaving}
                      maxLength={280}
                      style={{
                        padding: '8px 10px', fontSize: 13,
                        background: 'rgba(237,230,216,0.08)',
                        border: '1px solid rgba(237,230,216,0.18)',
                        borderRadius: 8, color: 'var(--sidebar-text)',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={commitAdjust}
                        disabled={adjustSaving || !adjustDelta}
                        className="btn-primary"
                        style={{ flex: 1, padding: '8px', fontSize: 12.5 }}
                      >
                        {adjustSaving ? <Loader2 size={12} className="spin" /> : <Check size={13} />}
                        Save
                      </button>
                      <button
                        onClick={cancelAdjust}
                        disabled={adjustSaving}
                        style={{
                          padding: '8px 12px', fontSize: 12.5,
                          background: 'transparent',
                          border: '1px solid rgba(237,230,216,0.2)',
                          borderRadius: 8, cursor: 'pointer',
                          color: 'rgba(237,230,216,0.85)',
                          fontFamily: 'inherit',
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAdjusting(true)}
                    style={{
                      width: '100%', padding: '8px',
                      background: 'rgba(237,230,216,0.08)',
                      border: '1px solid rgba(237,230,216,0.18)',
                      borderRadius: 8, cursor: 'pointer',
                      color: 'rgba(237,230,216,0.9)', fontSize: 12.5, fontWeight: 600,
                      fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <Pencil size={12} /> Adjust points
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: stats + orders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Quick stats */}
          <div className="tri-grid">
            {[
              { label: 'Orders',    value: activeOrders.length.toString(),                                                    Icon: ShoppingBag },
              { label: 'Spent',     value: formatCurrency(totalSpent),                                                        Icon: DollarSign },
              { label: 'Avg order', value: activeOrders.length ? formatCurrency(totalSpent / activeOrders.length) : '—',     Icon: BarChart3 },
            ].map(s => (
              <div key={s.label} className="card-sm">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <s.Icon size={14} strokeWidth={1.8} style={{ color: 'var(--ink-muted)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)' }}>{s.label}</span>
                </div>
                <div className="font-display" style={{ fontSize: 22, fontWeight: 400 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Order history */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Order history</span>
              <Link href={`/orders/new?customer=${customer.id}`} className="btn-primary" style={{ fontSize: 12.5, padding: '7px 12px' }}><Plus size={13} /> New order</Link>
            </div>

            {orders.length === 0 ? (
              <EmptyState Icon={ShoppingBag} title="No orders yet" description="This customer hasn't placed any orders." actionLabel="Create first order" actionHref={`/orders/new?customer=${customer.id}`} />
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order #</th>
                      <th>Items</th>
                      <th>Date</th>
                      <th>Points</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => {
                      const voided = o.status === 'void';
                      return (
                        <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)} style={{ opacity: voided ? 0.55 : 1 }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{o.order_number}</span>
                              {voided && <span style={{ fontSize: 10, fontWeight: 700, background: '#B71C1C', color: '#fff', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>VOID</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{formatDate(o.order_date)}</div>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 200 }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {o.order_items?.map(i => i.item_name).join(', ') ?? '—'}
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatDate(o.order_date)}</td>
                          <td>
                            {voided
                              ? <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>
                              : <span className="badge badge-neutral">+{o.points_earned} pts</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, textDecoration: voided ? 'line-through' : 'none', color: voided ? 'var(--text-muted)' : 'inherit' }}>
                            {formatCurrency(o.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ padding: '10px 20px', background: 'var(--warm-gray)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
                  <strong style={{ color: 'var(--text)' }}>Lifetime: {formatCurrency(totalSpent)}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
