'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import {
  Search, X, Save, Sparkles, Loader2, ChevronRight,
  Minus, Plus, Lock, Bird, Beef, Egg,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { Customer, NewOrderItemForm, PaymentMethod, ProductGroup, Product } from '@/types';
import { PAYMENT_METHODS, PAYMENT_LABEL } from '@/types';
import { formatCurrency } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import toast from 'react-hot-toast';

interface Props {
  preselectedCustomer: Customer | null;
  productGroups: ProductGroup[];
  isAdmin: boolean;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Darken a 7-char hex (e.g. #B0322B) by `amount` (0..1). Used to give the
// gradient bottom a deeper tone than the top without picking a second color.
function darkenHex(hex: string, amount = 0.22): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.round(r * (1 - amount)));
  g = Math.max(0, Math.round(g * (1 - amount)));
  b = Math.max(0, Math.round(b * (1 - amount)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function tileVars(accent: string): React.CSSProperties {
  return {
    ['--tile-accent' as string]: accent || '#0F172A',
    ['--tile-deep'   as string]: darkenHex(accent || '#0F172A', 0.28),
  };
}

const unitWord = (u: Product['unit']) => (u === 'each' ? 'each' : u === 'lb' ? 'lb' : 'tray');

// ─────────────────────────────────────────────────────────────
// Customer picker (chip-style for the top strip)
// ─────────────────────────────────────────────────────────────

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
    <div className="cust-chip">
      <Avatar name={value.full_name} size="sm" />
      <div className="cust-chip__body">
        <div className="cust-chip__name">{value.full_name}</div>
        <div className="cust-chip__meta">
          {value.customer_number} · {value.phone_number ?? 'No phone'} · <strong>{value.points_balance.toLocaleString()} pts</strong>
        </div>
      </div>
      <button type="button" onClick={() => onChange(null)} className="cust-chip__clear" aria-label="clear customer">
        <X size={14} />
      </button>
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
        <div className="cust-results">
          {results.slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => { onChange(c); setQuery(''); setOpen(false); }}
              className="cust-result">
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

// ─────────────────────────────────────────────────────────────
// Quantity stepper — used inside the editor modal. Light styling
// (sits on a white card, not a colored hero panel anymore).
// ─────────────────────────────────────────────────────────────

function Stepper({
  value, min = 1, step = 1, onChange,
}: { value: number; min?: number; step?: number; onChange: (v: number) => void }) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(value + step);
  return (
    <div className="stepper">
      <button type="button" onClick={dec} aria-label="decrease"><Minus size={16} strokeWidth={2.2} /></button>
      <input
        type="number" min={min} step={step} inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
      />
      <button type="button" onClick={inc} aria-label="increase"><Plus size={16} strokeWidth={2.2} /></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top-level catalog tile (browse mode)
// ─────────────────────────────────────────────────────────────

// Map each catalog group to a Lucide icon used as the card's
// background watermark. We deliberately reuse `Beef` for both goat
// groups — the difference is conveyed by title + accent stripe, not by
// inventing a second icon. There's no goat-specific icon in lucide,
// so the cow icon stands in for "livestock" across both goat cards.
type CardIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
const ICON_FOR_GROUP: Record<string, CardIcon> = {
  poultry:     Bird,
  whole_goat:  Beef,
  retail_goat: Beef,
  eggs:        Egg,
};

// Catalog card — compact, white background with a faded animal icon
// as a watermark, and a left-edge accent stripe in the group's color.
// Replaces the previous full-bleed colored hero tiles. Same data,
// professional aesthetic, and roughly half the vertical space.
function CatalogTile({ group, onClick }: { group: ProductGroup; onClick: () => void }) {
  const Icon: CardIcon = ICON_FOR_GROUP[group.code] ?? Beef;

  // Subline = compact summary so the staffer can verify the right
  // card without opening it.
  const subline = (() => {
    if (group.products.length === 1) {
      const p = group.products[0];
      return `${formatCurrency(p.default_price)} per ${unitWord(p.unit)}`;
    }
    return group.products
      .map((p) => {
        const short = p.name
          .replace(/^Retail goat — /, '')
          .replace(`${group.label} `, '')
          .trim();
        return `${short} ${formatCurrency(p.default_price)}`;
      })
      .join('  ·  ');
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      className="cat-card"
      style={tileVars(group.accent_color)}
    >
      <span className="cat-card__stripe" aria-hidden />
      <Icon className="cat-card__icon" size={120} strokeWidth={1.4} />
      <div className="cat-card__body">
        <h2 className="cat-card__title font-display">{group.label}</h2>
        <div className="cat-card__sub">{subline}</div>
      </div>
      <ChevronRight className="cat-card__chev" size={20} strokeWidth={2} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-product cards — same big colored style as the top tiles,
// but with the add-to-order controls embedded.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Editor sub-cards — compact rows shown inside the slide-down modal.
//
// No colored backgrounds. Each card is a single white row with a
// left accent stripe in the product's color, the product name + price
// on the left, and the input + Add button on the right. Wraps to two
// lines on narrow phones so nothing gets cramped.
// ─────────────────────────────────────────────────────────────

// 'each' or 'tray' product (Hen / Rooster / Duck / Eggs).
function CountCard({ product, onAdd }: { product: Product; onAdd: (lines: NewOrderItemForm[]) => void }) {
  const [qty, setQty] = useState(1);
  const n = Math.max(1, Math.floor(qty) || 1);
  const total = n * Number(product.default_price);

  return (
    <div className="ec-card" style={tileVars(product.accent_color)}>
      <span className="ec-card__stripe" aria-hidden />
      <div className="ec-card__head">
        <div className="ec-card__name">{product.name}</div>
        <div className="ec-card__price">{formatCurrency(product.default_price)} / {unitWord(product.unit)}</div>
      </div>
      <div className="ec-card__controls">
        <Stepper value={n} min={1} onChange={(v) => setQty(Math.floor(v))} />
        <button
          type="button"
          className="ec-card__add"
          onClick={() => {
            onAdd([{ item_name: product.name, quantity: n, unit_price: Number(product.default_price), product_code: product.code }]);
            setQty(1);
          }}
        >
          <Plus size={14} /> Add · {formatCurrency(total)}
        </button>
      </div>
    </div>
  );
}

// 'lb' product (Retail goat — with skin / without skin).
function WeightCard({ product, onAdd }: { product: Product; onAdd: (lines: NewOrderItemForm[]) => void }) {
  const [weight, setWeight] = useState('');
  const w = Math.max(0, Number(weight) || 0);
  const total = w * Number(product.default_price);

  return (
    <div className="ec-card" style={tileVars(product.accent_color)}>
      <span className="ec-card__stripe" aria-hidden />
      <div className="ec-card__head">
        <div className="ec-card__name">{product.name}</div>
        <div className="ec-card__price">{formatCurrency(product.default_price)} / lb</div>
      </div>
      <div className="ec-card__controls">
        <label className="ec-card__field">
          <span>Weight (lb)</span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <button
          type="button"
          className="ec-card__add"
          disabled={!(w > 0)}
          onClick={() => {
            onAdd([{ item_name: product.name, quantity: w, unit_price: Number(product.default_price), product_code: product.code }]);
            setWeight('');
          }}
        >
          <Plus size={14} /> Add · {formatCurrency(total)}
        </button>
      </div>
    </div>
  );
}

// Whole goat — single product, two inputs (total weight + goat count),
// plus a flat service fee.
function WholeGoatCard({ product, onAdd }: { product: Product; onAdd: (lines: NewOrderItemForm[]) => void }) {
  const [weight, setWeight] = useState('');
  const [count,  setCount]  = useState(1);
  const w = Math.max(0, Number(weight) || 0);
  const c = Math.max(1, Math.floor(count) || 1);
  const meat = w * Number(product.default_price);
  const fee  = c * Number(product.service_fee);
  const total = meat + fee;
  const canAdd = w > 0 && c > 0;

  return (
    <div className="ec-card ec-card--stack" style={tileVars(product.accent_color)}>
      <span className="ec-card__stripe" aria-hidden />
      <div className="ec-card__head">
        <div className="ec-card__name">{product.name}</div>
        <div className="ec-card__price">
          {formatCurrency(product.default_price)} / lb
          {Number(product.service_fee) > 0 && <>  ·  + {formatCurrency(product.service_fee)} fee / goat</>}
        </div>
      </div>
      <div className="ec-card__grid">
        <label className="ec-card__field">
          <span>Total weight (lb)</span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <div className="ec-card__field">
          <span>Goats</span>
          <Stepper value={c} min={1} onChange={(v) => setCount(Math.floor(v))} />
        </div>
      </div>
      <div className="ec-card__breakdown">
        <span>Meat <strong>{formatCurrency(meat)}</strong></span>
        {Number(product.service_fee) > 0 && <span>Service fee <strong>{formatCurrency(fee)}</strong></span>}
      </div>
      <button
        type="button"
        className="ec-card__add ec-card__add--full"
        disabled={!canAdd}
        onClick={() => {
          const lines: NewOrderItemForm[] = [
            { item_name: product.name, quantity: w, unit_price: Number(product.default_price), product_code: product.code },
          ];
          if (Number(product.service_fee) > 0) {
            lines.push({
              item_name: `${product.name} service fee`,
              quantity: c,
              unit_price: Number(product.service_fee),
              product_code: `service_fee:${product.code}`,
            });
          }
          onAdd(lines);
          setWeight(''); setCount(1);
        }}
      >
        <Plus size={14} /> Add to order · {formatCurrency(total)}
      </button>
    </div>
  );
}

// Dispatcher — picks the right editor card per product.
function editorCardFor(product: Product, onAdd: (lines: NewOrderItemForm[]) => void) {
  if (product.code === 'whole_goat')   return <WholeGoatCard key={product.id} product={product} onAdd={onAdd} />;
  if (product.unit === 'lb')           return <WeightCard    key={product.id} product={product} onAdd={onAdd} />;
  return <CountCard key={product.id} product={product} onAdd={onAdd} />;
}

// ─────────────────────────────────────────────────────────────
// Slide-down modal that hosts the editor for the active group.
// Backdrop click + ESC + the modal's close button all dismiss it;
// adding an item also dismisses it via the form's addLines() handler.
// ─────────────────────────────────────────────────────────────

function GroupModal({
  group, onAdd, onClose,
}: { group: ProductGroup; onAdd: (lines: NewOrderItemForm[]) => void; onClose: () => void }) {
  // ESC to close; lock body scroll while open so the page underneath
  // doesn't drift while the user is interacting with the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="gm-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="gm-modal"
        onClick={(e) => e.stopPropagation()}
        style={tileVars(group.accent_color)}
      >
        <header className="gm-modal__head">
          <span className="gm-modal__accent" aria-hidden />
          <div className="gm-modal__title-wrap">
            <div className="gm-modal__eyebrow">Adding from</div>
            <h2 className="gm-modal__title font-display">{group.label}</h2>
          </div>
          <button type="button" className="gm-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className="gm-modal__body">
          {group.products.map((p) => editorCardFor(p, onAdd))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────

export default function NewOrderForm({ preselectedCustomer, productGroups, isAdmin }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [customer,      setCustomer]      = useState<Customer | null>(preselectedCustomer);
  const [items,         setItems]         = useState<NewOrderItemForm[]>([]);
  const [notes,         setNotes]         = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [redeemPoints,    setRedeemPoints]    = useState('');
  const [redeemDiscount,  setRedeemDiscount]  = useState('');
  const [activeGroup,   setActiveGroup]   = useState<string | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const redeemPointsN   = isAdmin ? Math.max(0, Math.floor(Number(redeemPoints) || 0)) : 0;
  const redeemDiscountN = isAdmin ? Math.max(0, Math.round((Number(redeemDiscount) || 0) * 100) / 100) : 0;
  const discountCapped  = Math.min(redeemDiscountN, subtotal);
  const total           = Math.max(0, subtotal - discountCapped);
  const pointsEarned    = Math.floor(total);
  const customerBalance = customer?.points_balance ?? 0;
  const redeemError = (() => {
    if (!isAdmin) return null;
    if (redeemPointsN === 0 && redeemDiscountN === 0) return null;
    if (redeemPointsN > 0 && redeemDiscountN === 0)   return 'Enter the dollar discount for the redeemed points.';
    if (redeemPointsN === 0 && redeemDiscountN > 0)   return 'Enter how many points are being used.';
    if (redeemPointsN > customerBalance)              return `Customer only has ${customerBalance} points.`;
    if (redeemDiscountN > subtotal)                   return `Discount can't exceed the subtotal of $${subtotal.toFixed(2)}.`;
    return null;
  })();

  // After every Add, bounce back to the 4-card home so the next product
  // is one tap away. Same rhythm every time, no special-casing per
  // editor type. Staff who want two of the same group (e.g. hen + duck)
  // just re-tap the group card — the small extra tap is worth keeping
  // the flow predictable.
  const addLines = (lines: NewOrderItemForm[]) => {
    setItems((prev) => [...prev, ...lines]);
    toast.success(lines.length > 1 ? `Added ${lines[0].item_name} (+ fee)` : `Added ${lines[0].item_name}`);
    setActiveGroup(null);
  };
  const updateLinePrice = (idx: number, raw: string) => {
    if (!isAdmin) return;
    const v = Math.max(0, Number(raw) || 0);
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, unit_price: v } : it)));
  };
  // Removing a parent product also removes any attached service-fee
  // line that sits right after it in `items` — they were emitted as a
  // pair by the editor and must stay coupled. Staff cannot remove a
  // service-fee line directly (the X is hidden for them in the cart);
  // we re-check here as defense-in-depth.
  const removeLine = (idx: number) => setItems((prev) => {
    const target = prev[idx];
    if (!target) return prev;
    const targetCode = String(target.product_code ?? '');
    const isFee = targetCode.startsWith('service_fee:');
    if (!isAdmin && isFee) return prev;

    const next = prev[idx + 1];
    const removeNextToo =
      !isFee && targetCode && next?.product_code === `service_fee:${targetCode}`;

    return prev.filter((_, i) => i !== idx && !(removeNextToo && i === idx + 1));
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!customer)                              { setError('Please select a customer.'); return; }
    if (items.length === 0)                     { setError('Add at least one item from the catalog.'); return; }
    if (items.some((i) => Number(i.quantity) <= 0))  { setError('Quantity must be greater than 0.'); return; }
    if (items.some((i) => Number(i.unit_price) < 0)) { setError('Price cannot be negative.'); return; }
    if (redeemError)                            { setError(redeemError); return; }

    setSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id:         customer.id,
            notes,
            items,
            payment_method:      paymentMethod,
            points_redeemed:     redeemPointsN,
            redemption_discount: redeemDiscountN,
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? 'Failed');
        toast.success(`Order ${d.order_number} saved`);
        router.push(`/orders/${d.id}`);
      } catch (err: any) { setError(err.message); setSaving(false); }
    });
  }

  const active = activeGroup ? productGroups.find((g) => g.code === activeGroup) ?? null : null;

  return (
    <form onSubmit={submit}>
      <div className="page-stack">

        {/* ───── Top strip — customer + payment ───── */}
        <section className="top-strip card">
          <div className="top-strip__cell top-strip__cell--customer">
            <div className="label">Customer</div>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </div>
          <div className="top-strip__cell top-strip__cell--payment">
            <div className="label">Payment</div>
            <div className="payment-pills">
              {PAYMENT_METHODS.map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`payment-pill${paymentMethod === m ? ' is-active' : ''}`}
                  onClick={() => setPaymentMethod(m)}
                >
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ───── Catalog — the primary focus ─────
            The catalog grid is ALWAYS rendered. Tapping a card opens
            the editor as a slide-down modal (rendered below the
            page-stack) instead of swapping this content out. */}
        <section className="catalog-area">
          {productGroups.length === 0 ? (
            <div className="card empty-card">
              No products in the catalog yet. An admin can add them under <strong>Admin → Products</strong>.
            </div>
          ) : (
            <>
              <div className="catalog-area__head">
                <h1 className="catalog-area__title font-display">Choose a product</h1>
                <span className="catalog-area__hint">Tap a card to add it to the order</span>
              </div>
              <div className="big-grid big-grid--four">
                {productGroups.map((g) => (
                  <CatalogTile key={g.code} group={g} onClick={() => setActiveGroup(g.code)} />
                ))}
              </div>
            </>
          )}
        </section>

        {/* ───── Cart + summary + notes ───── */}
        <section className="checkout-grid">
          <div className="card cart">
            <div className="section-head">
              <h3 className="section-head__title">Order items</h3>
              {items.length > 0 && (
                <span className="section-head__hint">{items.length} {items.length === 1 ? 'line' : 'lines'}</span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="empty-state">
                <span>No items yet.</span>
                <span className="empty-state__hint">Pick a product above to start the order.</span>
              </div>
            ) : (
              <ul className="cart-list">
                {items.map((item, idx) => {
                  const isFee = String(item.product_code ?? '').startsWith('service_fee:');
                  return (
                    <li key={idx} className={`cart-row${isFee ? ' cart-row--fee' : ''}`}>
                      <div className="cart-row__main">
                        <div className="cart-row__name">{item.item_name}</div>
                        <div className="cart-row__meta">
                          {Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                          {' '}× {isAdmin ? '' : formatCurrency(item.unit_price)}
                          {!isAdmin && <span className="cart-row__lock" title="Catalog price"><Lock size={10} /></span>}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="cart-row__price">
                          <span className="cart-row__price-prefix">$</span>
                          <input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            className="cart-row__price-input"
                            value={item.unit_price}
                            onChange={(e) => updateLinePrice(idx, e.target.value)}
                          />
                        </div>
                      )}
                      <div className="cart-row__subtotal">
                        {formatCurrency(Number(item.quantity) * Number(item.unit_price))}
                      </div>
                      {/* Service-fee lines are attached to their parent product
                          and can't be removed independently by staff — the parent
                          line's X removes both. Admin keeps the X here in case
                          they're comping a fee separately. */}
                      {(isAdmin || !isFee) ? (
                        <button type="button" className="cart-row__remove" onClick={() => removeLine(idx)} aria-label="remove">
                          <X size={14} />
                        </button>
                      ) : (
                        <span
                          className="cart-row__lock-slot"
                          title="Attached to the goat above — removing the goat removes the fee"
                          aria-label="fee locked to parent product"
                        >
                          <Lock size={12} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {!isAdmin && items.length > 0 && (
              <div className="staff-note">
                <Lock size={11} /> Prices are set by the catalog. An admin can override at checkout.
              </div>
            )}

            <div className="notes-block">
              <label className="label" htmlFor="order-notes">Notes (optional)</label>
              <textarea
                id="order-notes"
                className="input-field"
                rows={2}
                placeholder="Special instructions…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ resize: 'none' }}
              />
            </div>
          </div>

          {/* Summary */}
          <div className="card summary">
            <div className="section-head">
              <h3 className="section-head__title">Summary</h3>
            </div>

            <div className="summary-mini">
              <SummaryRow label={`Subtotal · ${items.length} ${items.length === 1 ? 'item' : 'items'}`} value={formatCurrency(subtotal)} />

              {isAdmin && customer && (
                <div className="redeem-box">
                  <div className="redeem-box__title">
                    Use loyalty points
                    <span className="redeem-box__balance">customer has {customerBalance.toLocaleString()}</span>
                  </div>
                  <div className="redeem-box__row">
                    <label className="field">
                      <span className="field__label">Points used</span>
                      <input
                        type="number" min="0" step="1" inputMode="numeric"
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                        placeholder="0"
                        className="input-field input-field--mono"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Discount $</span>
                      <input
                        type="number" min="0" step="0.01" inputMode="decimal"
                        value={redeemDiscount}
                        onChange={(e) => setRedeemDiscount(e.target.value)}
                        placeholder="0.00"
                        className="input-field input-field--mono"
                      />
                    </label>
                  </div>
                  {redeemError && <div className="redeem-box__err">{redeemError}</div>}
                </div>
              )}

              {discountCapped > 0 && (
                <SummaryRow
                  label={`Loyalty discount (${redeemPointsN} pts)`}
                  value={`− ${formatCurrency(discountCapped)}`}
                />
              )}

              <SummaryRow
                label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} /> Points earned</span>}
                value={`+${pointsEarned}`}
              />
            </div>

            <div className="total-row">
              <span className="total-row__label">Total</span>
              <span className="total-row__value font-display">{formatCurrency(total)}</span>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="cta-row">
              <button type="button" onClick={() => router.back()} className="btn-secondary cta-row__cancel">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary cta-row__save">
                {saving
                  ? <><Loader2 size={14} className="spin" /> Saving…</>
                  : <><Save size={14} /> Save order · {formatCurrency(total)}</>}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Slide-down editor modal — only mounted when a category is
          active. Lives outside .page-stack so the backdrop overlays
          the entire page. */}
      {active && (
        <GroupModal
          group={active}
          onAdd={addLines}
          onClose={() => setActiveGroup(null)}
        />
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Page layout ────────────────────────────────────────── */
        .page-stack {
          display: flex; flex-direction: column; gap: 20px;
        }

        /* ── Top strip ──────────────────────────────────────────── */
        .top-strip {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 24px;
          padding: 18px 22px;
        }
        .top-strip__cell {
          display: flex; flex-direction: column; gap: 8px;
          min-width: 0;
        }
        .top-strip__cell--payment { border-left: 1px solid var(--border-soft); padding-left: 24px; }

        :global(.cust-chip) {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          background: var(--surface-2);
          border: 1px solid var(--border);
        }
        :global(.cust-chip__body) { flex: 1; min-width: 0; }
        :global(.cust-chip__name) {
          font-size: 14.5px; font-weight: 600; color: var(--ink);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        :global(.cust-chip__meta) {
          font-size: 12px; color: var(--ink-muted);
          font-family: ui-monospace, SFMono-Regular, monospace;
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        :global(.cust-chip__meta strong) { color: var(--ink-2); font-weight: 600; }
        :global(.cust-chip__clear) {
          width: 32px; height: 32px;
          border-radius: 10px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--ink-muted);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 120ms;
        }
        :global(.cust-chip__clear:hover) { background: var(--surface); color: var(--ink); }

        :global(.cust-results) {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          z-index: 50;
          overflow: hidden;
        }
        :global(.cust-result) {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 10px 14px;
          background: transparent; border: none;
          cursor: pointer; font-family: inherit;
          transition: background 100ms;
          text-align: left;
        }
        :global(.cust-result:hover) { background: var(--surface-2); }

        /* ── Payment pills ──────────────────────────────────────── */
        .payment-pills {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
        }
        .payment-pill {
          padding: 12px 8px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          font: inherit; font-size: 13.5px; font-weight: 600;
          color: var(--ink-2);
          cursor: pointer;
          transition: all 140ms;
          min-height: 44px;
        }
        .payment-pill:hover { border-color: var(--ink-faint); }
        .payment-pill.is-active {
          background: var(--ink); color: var(--bg); border-color: var(--ink);
        }

        /* ── Catalog area ───────────────────────────────────────── */
        .catalog-area {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 22px;
          padding: 22px;
          box-shadow: var(--shadow-sm);
          display: flex; flex-direction: column; gap: 18px;
        }
        .catalog-area__head {
          display: flex; align-items: baseline; justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }
        .catalog-area__head--editor {
          align-items: center;
        }
        .catalog-area__title {
          font-size: 26px;
          letter-spacing: -0.01em;
          color: var(--ink);
        }
        .catalog-area__hint {
          font-size: 13px;
          color: var(--ink-muted);
        }

        .back-pill {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 8px 12px 8px 8px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink-2);
          font: inherit; font-size: 13px; font-weight: 600;
          cursor: pointer;
          transition: all 140ms;
        }
        .back-pill:hover { background: var(--surface-2); border-color: var(--ink-faint); color: var(--ink); }

        /* ── Big grid layouts (4 / 3 / 2 / 1 cards) ─────────────── */
        :global(.big-grid)         { display: grid; gap: 12px; }
        /* Top-level catalog: ALWAYS one card per row on mobile so cards
           never share a row (and stay full-width). Desktop opens to 2-up. */
        :global(.big-grid--four)   { grid-template-columns: 1fr; }
        :global(.big-grid--three)  { grid-template-columns: repeat(3, 1fr); }
        :global(.big-grid--two)    { grid-template-columns: repeat(2, 1fr); }
        :global(.big-grid--one)    { grid-template-columns: minmax(0, 720px); justify-content: center; }
        @media (min-width: 768px) {
          :global(.big-grid--four) { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        }

        /* ── Catalog card (top-level tile) ─────────────────────────
           Compact, white, with an animal icon as a faded watermark on
           the right and an accent stripe on the left in the group's
           color. Replaces the previous full-bleed colored hero tile.
           Mobile = full-width, ~96px tall. Desktop = 2-up, ~120px tall. */
        :global(.cat-card) {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          min-height: 96px;
          padding: 14px 18px 14px 26px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          box-shadow: var(--shadow-sm);
          transition: transform 140ms ease, box-shadow 160ms ease, border-color 140ms ease;
        }
        :global(.cat-card:hover) {
          transform: translateY(-1px);
          border-color: var(--ink-faint);
          box-shadow: var(--shadow-md);
        }
        :global(.cat-card:active) { transform: translateY(0); }
        :global(.cat-card:focus-visible) {
          outline: 3px solid var(--tile-accent);
          outline-offset: 2px;
        }

        /* Accent stripe — the only colored element on the card, so the
           group identity reads at a glance without overwhelming. */
        :global(.cat-card__stripe) {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 5px;
          background: var(--tile-accent);
          border-radius: var(--r-lg) 0 0 var(--r-lg);
        }

        /* Animal icon — large, faded, sits to the right and never
           interferes with the title. pointer-events:none so taps
           pass through to the card itself. */
        :global(.cat-card__icon) {
          position: absolute;
          right: -8px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--tile-accent);
          opacity: 0.10;
          pointer-events: none;
        }

        :global(.cat-card__body) {
          position: relative;
          z-index: 1;
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        :global(.cat-card__title) {
          font-size: var(--text-xl);    /* 20px on mobile */
          font-weight: 400;             /* serif font carries the weight visually */
          line-height: 1.15;
          color: var(--ink);
          letter-spacing: -0.015em;
        }
        :global(.cat-card__sub) {
          font-size: var(--text-sm);
          color: var(--ink-muted);
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        :global(.cat-card__chev) {
          position: relative;
          z-index: 1;
          flex-shrink: 0;
          color: var(--ink-faint);
          transition: transform 140ms ease, color 140ms ease;
        }
        :global(.cat-card:hover .cat-card__chev) {
          color: var(--tile-accent);
          transform: translateX(3px);
        }

        @media (min-width: 768px) {
          :global(.cat-card) { min-height: 120px; padding: 18px 22px 18px 30px; }
          :global(.cat-card__title) { font-size: var(--text-2xl); }
          :global(.cat-card__icon)  { right: -4px; }
        }

        /* ─────────────────────────────────────────────────────────
           Slide-down modal (GroupModal)
           ─────────────────────────────────────────────────────────
           Backdrop dims the page, modal drops in from above. Anchored
           to the top of the viewport so the user's eye naturally goes
           up to the title (the category they just tapped). */
        :global(.gm-backdrop) {
          position: fixed; inset: 0;
          z-index: 100;
          background: rgba(20,17,15,0.45);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 16px;
          padding-top: max(16px, env(safe-area-inset-top));
          overflow-y: auto;
          animation: gm-fade 200ms ease-out;
        }
        @keyframes gm-fade { from { opacity: 0; } to { opacity: 1; } }

        :global(.gm-modal) {
          width: 100%;
          max-width: 640px;
          background: var(--surface);
          border-radius: 18px;
          border: 1px solid var(--border);
          box-shadow: 0 30px 80px rgba(0,0,0,0.30), 0 8px 22px rgba(0,0,0,0.10);
          overflow: hidden;
          animation: gm-drop 260ms cubic-bezier(.2,.7,.2,1);
        }
        @keyframes gm-drop {
          from { transform: translateY(-24px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }

        :global(.gm-modal__head) {
          position: relative;
          display: flex; align-items: center;
          gap: 14px;
          padding: 16px 18px 16px 22px;
          border-bottom: 1px solid var(--border-soft);
          background: var(--surface);
        }
        :global(.gm-modal__accent) {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 5px;
          background: var(--tile-accent);
        }
        :global(.gm-modal__title-wrap) { flex: 1; min-width: 0; }
        :global(.gm-modal__eyebrow) {
          font-size: var(--text-xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--ink-muted);
        }
        :global(.gm-modal__title) {
          font-size: var(--text-2xl);
          line-height: 1.15;
          letter-spacing: -0.015em;
          color: var(--ink);
          margin-top: 2px;
        }
        :global(.gm-modal__close) {
          width: 36px; height: 36px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink-2);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 120ms;
          flex-shrink: 0;
        }
        :global(.gm-modal__close:hover) {
          background: var(--ink); color: var(--bg); border-color: var(--ink);
        }
        :global(.gm-modal__body) {
          padding: 16px;
          display: flex; flex-direction: column;
          gap: 10px;
        }

        /* ─────────────────────────────────────────────────────────
           Editor card (.ec-card) — one row per sub-product inside
           the modal. White background, left accent stripe in the
           product's color, name + price on the left, controls +
           Add button on the right. Wraps to two lines on phones.
           ───────────────────────────────────────────────────────── */
        :global(.ec-card) {
          position: relative;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 14px;
          padding: 12px 14px 12px 22px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        :global(.ec-card__stripe) {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 4px;
          background: var(--tile-accent);
          border-radius: 12px 0 0 12px;
        }
        :global(.ec-card__head) { min-width: 0; }
        :global(.ec-card__name) {
          font-size: var(--text-base);
          font-weight: 600;
          color: var(--ink);
          letter-spacing: -0.005em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        :global(.ec-card__price) {
          font-size: var(--text-xs);
          color: var(--ink-muted);
          margin-top: 2px;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        :global(.ec-card__controls) {
          display: flex; align-items: center;
          gap: 10px;
          justify-self: end;
        }
        :global(.ec-card__field) {
          display: flex; flex-direction: column; gap: 4px;
        }
        :global(.ec-card__field > span) {
          font-size: 10.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ink-muted);
        }
        :global(.ec-card__field input) {
          width: 110px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          outline: none;
          color: var(--ink);
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: var(--text-base);
          text-align: center;
        }
        :global(.ec-card__field input:focus) {
          border-color: var(--tile-accent);
          box-shadow: 0 0 0 3px rgba(176,50,43,0.10);
        }
        :global(.ec-card__add) {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          border-radius: 10px;
          background: var(--tile-accent);
          color: #fff;
          border: none;
          font-family: inherit;
          font-size: var(--text-sm);
          font-weight: 600;
          cursor: pointer;
          min-height: 44px;
          transition: filter 120ms ease, transform 80ms ease;
        }
        :global(.ec-card__add:hover) { filter: brightness(1.05); }
        :global(.ec-card__add:active) { transform: translateY(1px); }
        :global(.ec-card__add:disabled) {
          background: var(--surface-2); color: var(--ink-faint);
          cursor: not-allowed; transform: none;
        }
        :global(.ec-card__add--full) { width: 100%; }

        /* Whole-goat variant: stacked layout (multiple fields + breakdown). */
        :global(.ec-card--stack) {
          grid-template-columns: 1fr;
          gap: 12px;
          padding: 14px 16px 14px 22px;
        }
        :global(.ec-card__grid) {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px;
          align-items: end;
        }
        :global(.ec-card__breakdown) {
          display: flex; gap: 14px; flex-wrap: wrap;
          padding: 8px 12px;
          background: var(--surface-2);
          border: 1px solid var(--border-soft);
          border-radius: 8px;
          font-size: var(--text-xs);
          color: var(--ink-muted);
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        :global(.ec-card__breakdown strong) { color: var(--ink); font-weight: 700; }

        /* Stepper used inside editor cards (white background, dark ink) */
        :global(.stepper) {
          display: inline-flex; align-items: stretch;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
          height: 44px;
        }
        :global(.stepper > button) {
          width: 40px;
          background: transparent;
          border: none;
          color: var(--ink-2);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: background 120ms;
        }
        :global(.stepper > button:hover) { background: var(--surface-2); color: var(--ink); }
        :global(.stepper input) {
          width: 52px;
          border: none;
          outline: none;
          background: transparent;
          text-align: center;
          font-size: var(--text-base);
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, monospace;
          color: var(--ink);
          font-feature-settings: 'tnum';
          -moz-appearance: textfield;
        }
        :global(.stepper input::-webkit-outer-spin-button),
        :global(.stepper input::-webkit-inner-spin-button) {
          -webkit-appearance: none; margin: 0;
        }

        /* Mobile: editor cards wrap controls below name to give inputs
           full width and avoid cramped rows. */
        @media (max-width: 600px) {
          :global(.ec-card) {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          :global(.ec-card__controls) {
            justify-self: stretch;
            justify-content: space-between;
          }
          :global(.ec-card__field input) { width: 100%; }
        }

        /* ── Checkout grid (cart left + summary right) ──────────── */
        .checkout-grid {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 20px;
          align-items: start;
        }

        /* ── Section heading inside a card ──────────────────────── */
        :global(.section-head) {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
          padding-bottom: 14px;
          margin-bottom: 18px;
          border-bottom: 1px solid var(--border-soft);
        }
        :global(.section-head__title) {
          font-size: 16px; font-weight: 600;
          letter-spacing: -0.01em; color: var(--ink);
        }
        :global(.section-head__hint) {
          font-size: 12px; color: var(--ink-muted);
        }

        /* ── Cart list ──────────────────────────────────────────── */
        :global(.cart-list) {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 1px;
          background: var(--border-soft);
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid var(--border-soft);
        }
        :global(.cart-row) {
          display: grid;
          grid-template-columns: 1fr auto auto 36px;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          background: var(--surface);
        }
        :global(.cart-row--fee) { background: var(--surface-2); }
        :global(.cart-row__main) { min-width: 0; }
        :global(.cart-row__name) {
          font-size: 14px; font-weight: 600; color: var(--ink);
          letter-spacing: -0.005em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        :global(.cart-row__meta) {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12.5px; color: var(--ink-muted);
          font-family: ui-monospace, SFMono-Regular, monospace;
          margin-top: 2px;
        }
        :global(.cart-row__lock) { color: var(--ink-faint); display: inline-flex; }
        :global(.cart-row__price) { position: relative; width: 110px; }
        :global(.cart-row__price-prefix) {
          position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
          color: var(--ink-muted); font-size: 12px; font-weight: 600;
        }
        :global(.cart-row__price-input) {
          width: 100%;
          padding: 8px 8px 8px 20px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13px;
          text-align: right;
          outline: none;
        }
        :global(.cart-row__price-input:focus) {
          border-color: var(--ink);
          box-shadow: 0 0 0 3px rgba(26,23,21,0.07);
        }
        :global(.cart-row__subtotal) {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 14px; font-weight: 600;
          color: var(--ink);
          text-align: right;
          min-width: 80px;
        }
        :global(.cart-row__remove) {
          width: 32px; height: 32px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--ink-muted);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 120ms;
        }
        :global(.cart-row__remove:hover) { background: var(--danger-bg); color: var(--danger); }

        /* Same footprint as .cart-row__remove so the row's grid stays
           aligned whether the column shows an X or a lock. */
        :global(.cart-row__lock-slot) {
          width: 32px; height: 32px;
          border-radius: 8px;
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--ink-faint);
          cursor: not-allowed;
        }

        :global(.staff-note) {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 12px;
          font-size: 11.5px; color: var(--ink-muted);
        }

        .notes-block {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px dashed var(--border);
        }

        /* ── Empty state ────────────────────────────────────────── */
        :global(.empty-state) {
          padding: 30px 16px;
          text-align: center;
          font-size: 13.5px;
          color: var(--ink-muted);
          background: var(--surface-2);
          border-radius: 14px;
          border: 1px dashed var(--border);
          display: flex; flex-direction: column; gap: 4px;
        }
        :global(.empty-state__hint) { font-size: 12px; color: var(--ink-faint); }
        :global(.empty-card) {
          padding: 30px 22px;
          text-align: center;
          font-size: 14px;
          color: var(--ink-muted);
        }

        /* ── Summary internals ──────────────────────────────────── */
        :global(.summary-mini) {
          display: flex; flex-direction: column; gap: 8px;
        }
        :global(.summary-row) {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 14px;
        }
        :global(.summary-row__label) { color: var(--ink-muted); }
        :global(.summary-row__value) {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-weight: 600; color: var(--ink);
        }
        :global(.summary-row--emphasis) {
          padding-top: 8px; margin-top: 2px;
          border-top: 1px solid var(--border-soft);
        }
        :global(.summary-row--emphasis .summary-row__label) { color: var(--ink); font-weight: 600; }

        :global(.field) { display: flex; flex-direction: column; gap: 6px; }
        :global(.field__label) {
          font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--ink-muted);
        }
        :global(.input-field--mono) {
          font-family: ui-monospace, SFMono-Regular, monospace !important;
          padding: 10px 12px !important;
        }

        .redeem-box {
          margin-top: 8px;
          padding: 14px;
          border-radius: 12px;
          background: var(--surface-2);
          border: 1px solid var(--border-soft);
          display: flex; flex-direction: column; gap: 10px;
        }
        .redeem-box__title {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px;
          font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--ink-muted);
        }
        .redeem-box__balance { font-weight: 500; letter-spacing: 0; text-transform: none; }
        .redeem-box__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .redeem-box__err { font-size: 12px; color: var(--danger); }

        .total-row {
          display: flex; align-items: baseline; justify-content: space-between;
          padding: 16px 4px 8px;
          margin-top: 14px;
          border-top: 1px solid var(--border);
        }
        .total-row__label {
          font-size: 13px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--ink-muted);
        }
        .total-row__value {
          font-size: 36px; line-height: 1.05; color: var(--ink);
        }

        .cta-row { display: flex; gap: 10px; margin-top: 18px; }
        .cta-row__cancel { padding: 14px 20px; min-height: 52px; }
        .cta-row__save   { flex: 1; padding: 14px 20px; min-height: 52px; font-size: 14.5px; }

        .form-error {
          margin-top: 16px;
          background: var(--danger-bg);
          color: var(--danger);
          border: 1px solid var(--danger-soft);
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 13px; font-weight: 500;
        }

        /* ── Tablet ─────────────────────────────────────────────── */
        @media (max-width: 1023px) {
          .checkout-grid { grid-template-columns: 1fr; }
        }

        /* ── Mobile ─────────────────────────────────────────────── */
        @media (max-width: 767px) {
          .top-strip { grid-template-columns: 1fr; gap: 16px; padding: 16px; }
          .top-strip__cell--payment { border-left: none; padding-left: 0; border-top: 1px solid var(--border-soft); padding-top: 16px; }

          .catalog-area { padding: 16px; border-radius: 18px; }
          .catalog-area__title { font-size: 22px; }

          :global(.big-grid--four),
          :global(.big-grid--three),
          :global(.big-grid--two),
          :global(.big-grid--one)   { grid-template-columns: 1fr; gap: 12px; }

          :global(.big-tile) { min-height: 220px; padding: 20px; border-radius: 20px; }
          :global(.big-tile__title) { font-size: 26px; }
          :global(.big-tile__orb) { width: 160px; height: 160px; top: -40px; right: -40px; }
          :global(.big-tile__primary) { min-height: 50px; padding: 12px 16px; }

          :global(.cart-row) {
            grid-template-columns: 1fr 36px;
            grid-template-areas:
              'main    remove'
              'price   price'
              'sub     sub';
            row-gap: 8px;
          }
          :global(.cart-row__main)     { grid-area: main; }
          :global(.cart-row__remove)   { grid-area: remove; justify-self: end; }
          :global(.cart-row__price)    { grid-area: price; width: 100%; }
          :global(.cart-row__subtotal) { grid-area: sub; text-align: right; font-size: 16px; }

          .total-row__value { font-size: 28px; }
          .cta-row { flex-direction: column-reverse; }
          .cta-row__cancel { width: 100%; }
        }
      `}</style>
    </form>
  );
}

function SummaryRow({ label, value, emphasis }: { label: React.ReactNode; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className={`summary-row${emphasis ? ' summary-row--emphasis' : ''}`}>
      <span className="summary-row__label">{label}</span>
      <span className="summary-row__value">{value}</span>
    </div>
  );
}
