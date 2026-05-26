'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { Search, X, Save, Sparkles, Loader2, ChevronLeft, Minus, Plus, Lock } from 'lucide-react';
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
    ['--tile-accent' as string]: accent || '#1A1715',
    ['--tile-deep'   as string]: darkenHex(accent || '#1A1715', 0.28),
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
// Quantity stepper (used inside dark cards — high-contrast variant)
// ─────────────────────────────────────────────────────────────

function DarkStepper({
  value, min = 1, step = 1, onChange,
}: { value: number; min?: number; step?: number; onChange: (v: number) => void }) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(value + step);
  return (
    <div className="dark-stepper">
      <button type="button" onClick={dec} aria-label="decrease"><Minus size={16} strokeWidth={2.4} /></button>
      <input
        type="number" min={min} step={step} inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
      />
      <button type="button" onClick={inc} aria-label="increase"><Plus size={16} strokeWidth={2.4} /></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top-level catalog tile (browse mode)
// ─────────────────────────────────────────────────────────────

function CatalogTile({ group, onClick }: { group: ProductGroup; onClick: () => void }) {
  const eyebrow = (() => {
    switch (group.code) {
      case 'poultry':     return 'Poultry';
      case 'whole_goat':  return 'Whole goat';
      case 'retail_goat': return 'Cuts · retail';
      case 'eggs':        return 'Fresh eggs';
      default:            return group.label;
    }
  })();

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
    <button type="button" onClick={onClick} className="big-tile" style={tileVars(group.accent_color)}>
      <div className="big-tile__orb" />
      <div className="big-tile__sheen" />
      <div className="big-tile__top">
        <span className="big-tile__eyebrow">{eyebrow}</span>
      </div>
      <div className="big-tile__bottom">
        <h2 className="big-tile__title font-display">{group.label}</h2>
        <div className="big-tile__subline">{subline}</div>
        <div className="big-tile__cta"><span>Tap to add</span><span className="big-tile__arrow">→</span></div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-product cards — same big colored style as the top tiles,
// but with the add-to-order controls embedded.
// ─────────────────────────────────────────────────────────────

// Card for a single 'each' or 'tray' product (Hen / Rooster / Duck / Eggs).
function CountCard({ product, onAdd }: { product: Product; onAdd: (lines: NewOrderItemForm[]) => void }) {
  const [qty, setQty] = useState(1);
  const n = Math.max(1, Math.floor(qty) || 1);
  const total = n * Number(product.default_price);

  return (
    <div className="big-tile big-tile--editor" style={tileVars(product.accent_color)}>
      <div className="big-tile__orb" />
      <div className="big-tile__sheen" />
      <div className="big-tile__top">
        <span className="big-tile__eyebrow">{formatCurrency(product.default_price)} / {unitWord(product.unit)}</span>
      </div>
      <div className="big-tile__bottom">
        <h2 className="big-tile__title font-display">{product.name}</h2>
        <div className="big-tile__controls">
          <DarkStepper value={n} min={1} onChange={(v) => setQty(Math.floor(v))} />
          <button
            type="button"
            className="big-tile__primary"
            onClick={() => {
              onAdd([{ item_name: product.name, quantity: n, unit_price: Number(product.default_price), product_code: product.code }]);
              setQty(1);
            }}
          >
            <Plus size={14} /> Add · {formatCurrency(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

// Card for a 'lb' product (Retail goat — with skin / without skin).
function WeightCard({ product, onAdd }: { product: Product; onAdd: (lines: NewOrderItemForm[]) => void }) {
  const [weight, setWeight] = useState('');
  const w = Math.max(0, Number(weight) || 0);
  const total = w * Number(product.default_price);

  return (
    <div className="big-tile big-tile--editor" style={tileVars(product.accent_color)}>
      <div className="big-tile__orb" />
      <div className="big-tile__sheen" />
      <div className="big-tile__top">
        <span className="big-tile__eyebrow">{formatCurrency(product.default_price)} / lb</span>
      </div>
      <div className="big-tile__bottom">
        <h2 className="big-tile__title font-display">{product.name}</h2>
        <div className="big-tile__controls">
          <label className="dark-field" style={{ flex: 1 }}>
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
            className="big-tile__primary"
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
    </div>
  );
}

// Whole goat — single product but takes weight AND number of goats, plus
// a flat per-goat service fee. Lives in one big card.
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
    <div className="big-tile big-tile--editor big-tile--wide" style={tileVars(product.accent_color)}>
      <div className="big-tile__orb" />
      <div className="big-tile__sheen" />
      <div className="big-tile__top">
        <span className="big-tile__eyebrow">
          {formatCurrency(product.default_price)} / lb
          {Number(product.service_fee) > 0 && <>  ·  + {formatCurrency(product.service_fee)} service fee / goat</>}
        </span>
      </div>
      <div className="big-tile__bottom">
        <h2 className="big-tile__title font-display">{product.name}</h2>
        <div className="big-tile__controls big-tile__controls--stack">
          <div className="big-tile__row">
            <label className="dark-field" style={{ flex: 1 }}>
              <span>Total weight (lb)</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <div className="dark-field">
              <span>Goats</span>
              <DarkStepper value={c} min={1} onChange={(v) => setCount(Math.floor(v))} />
            </div>
          </div>
          <div className="big-tile__breakdown">
            <span>Meat {formatCurrency(meat)}</span>
            {Number(product.service_fee) > 0 && <span>Service fee {formatCurrency(fee)}</span>}
          </div>
          <button
            type="button"
            className="big-tile__primary big-tile__primary--full"
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
      </div>
    </div>
  );
}

// Dispatcher — picks the right big card per product.
function bigCardFor(product: Product, onAdd: (lines: NewOrderItemForm[]) => void) {
  if (product.code === 'whole_goat')   return <WholeGoatCard key={product.id} product={product} onAdd={onAdd} />;
  if (product.unit === 'lb')           return <WeightCard    key={product.id} product={product} onAdd={onAdd} />;
  return <CountCard key={product.id} product={product} onAdd={onAdd} />;
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
  const editorCols = active?.products.length ?? 0;

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

        {/* ───── Catalog — the primary focus ───── */}
        <section className="catalog-area">
          {productGroups.length === 0 ? (
            <div className="card empty-card">
              No products in the catalog yet. An admin can add them under <strong>Admin → Products</strong>.
            </div>
          ) : !active ? (
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
          ) : (
            <>
              <div className="catalog-area__head catalog-area__head--editor">
                <button type="button" className="back-pill" onClick={() => setActiveGroup(null)}>
                  <ChevronLeft size={16} /> All products
                </button>
                <h1 className="catalog-area__title font-display">{active.label}</h1>
                <span className="catalog-area__hint">{editorCols === 1 ? 'One option' : `${editorCols} options · pick one or more`}</span>
              </div>
              <div className={`big-grid big-grid--${editorCols === 1 ? 'one' : editorCols === 2 ? 'two' : editorCols === 3 ? 'three' : 'four'}`}>
                {active.products.map((p) => bigCardFor(p, addLines))}
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
        :global(.big-grid)         { display: grid; gap: 18px; }
        :global(.big-grid--four)   { grid-template-columns: repeat(2, 1fr); }
        :global(.big-grid--three)  { grid-template-columns: repeat(3, 1fr); }
        :global(.big-grid--two)    { grid-template-columns: repeat(2, 1fr); }
        :global(.big-grid--one)    { grid-template-columns: minmax(0, 720px); justify-content: center; }

        /* ── Big tile (shared by catalog tiles + sub-cards) ─────── */
        :global(.big-tile) {
          position: relative;
          overflow: hidden;
          border: 2px solid rgba(255,255,255,0.18);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          color: #fff;
          min-height: 300px;
          padding: 24px;
          border-radius: 24px;
          display: flex; flex-direction: column;
          background:
            radial-gradient(140% 90% at -10% 110%, rgba(0,0,0,0.35), transparent 55%),
            linear-gradient(180deg, var(--tile-accent) 0%, var(--tile-deep) 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,0.08) inset,
            0 14px 32px rgba(22,19,17,0.20),
            0 2px 8px rgba(22,19,17,0.10);
          transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
        }
        :global(button.big-tile:hover) {
          transform: translateY(-2px);
          box-shadow:
            0 1px 0 rgba(255,255,255,0.08) inset,
            0 22px 44px rgba(22,19,17,0.26),
            0 3px 10px rgba(22,19,17,0.12);
          filter: saturate(1.05);
        }
        :global(button.big-tile:active) { transform: translateY(0); }
        :global(button.big-tile:focus-visible) {
          outline: 3px solid rgba(255,255,255,0.6); outline-offset: 3px;
        }
        :global(.big-tile--editor) { cursor: default; }
        :global(.big-tile--editor:hover) { transform: none; filter: none; }

        :global(.big-tile__orb) {
          position: absolute; top: -60px; right: -60px;
          width: 220px; height: 220px; border-radius: 50%;
          background: radial-gradient(circle at center, rgba(255,255,255,0.22), transparent 65%);
          pointer-events: none;
        }
        :global(.big-tile__sheen) {
          position: absolute; inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 30%);
          pointer-events: none;
        }

        :global(.big-tile__top) { position: relative; z-index: 1; }
        :global(.big-tile__eyebrow) {
          display: inline-block;
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.18);
          backdrop-filter: blur(6px);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.95);
        }

        :global(.big-tile__bottom) {
          position: relative; z-index: 1;
          margin-top: auto;
          display: flex; flex-direction: column; gap: 14px;
        }
        :global(.big-tile__title) {
          font-size: 32px;
          line-height: 1.05;
          letter-spacing: -0.015em;
          color: #fff;
          font-weight: 400;
        }
        :global(.big-tile__subline) {
          font-size: 13.5px;
          color: rgba(255,255,255,0.85);
          line-height: 1.5;
        }
        :global(.big-tile__cta) {
          margin-top: 4px;
          display: inline-flex; align-items: center;
          gap: 8px;
          align-self: flex-start;
          padding: 9px 15px;
          background: #fff;
          color: var(--ink);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(0,0,0,0.18);
          transition: transform 140ms ease;
        }
        :global(.big-tile__arrow) { transition: transform 140ms ease; }
        :global(button.big-tile:hover .big-tile__cta)    { transform: translateX(2px); }
        :global(button.big-tile:hover .big-tile__arrow)  { transform: translateX(3px); }

        /* ── Embedded controls inside editor cards ──────────────── */
        :global(.big-tile__controls) {
          display: flex; align-items: stretch; gap: 10px;
          flex-wrap: wrap;
        }
        :global(.big-tile__controls--stack) { flex-direction: column; }
        :global(.big-tile__row) { display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; }
        :global(.big-tile__primary) {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 8px;
          padding: 14px 18px;
          border-radius: 14px;
          background: #fff;
          color: var(--ink);
          border: none;
          font-family: inherit; font-size: 14px; font-weight: 600;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(0,0,0,0.22);
          transition: transform 100ms ease, box-shadow 140ms ease, opacity 140ms ease;
          min-height: 52px;
          flex: 1;
        }
        :global(.big-tile__primary:hover) { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(0,0,0,0.30); }
        :global(.big-tile__primary:active) { transform: translateY(0); }
        :global(.big-tile__primary:disabled) { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
        :global(.big-tile__primary--full) { width: 100%; flex: none; }

        :global(.big-tile__breakdown) {
          display: flex; gap: 14px; flex-wrap: wrap;
          padding: 8px 12px;
          background: rgba(0,0,0,0.18);
          border-radius: 10px;
          font-size: 12.5px;
          color: rgba(255,255,255,0.92);
          font-family: ui-monospace, SFMono-Regular, monospace;
        }

        :global(.dark-field) {
          display: flex; flex-direction: column; gap: 4px;
          color: rgba(255,255,255,0.85);
        }
        :global(.dark-field > span) {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.78);
        }
        :global(.dark-field input) {
          padding: 13px 14px;
          border-radius: 12px;
          background: rgba(255,255,255,0.95);
          color: var(--ink);
          border: 1px solid rgba(255,255,255,0.65);
          outline: none;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 15px;
          text-align: center;
          min-height: 50px;
          transition: box-shadow 140ms;
        }
        :global(.dark-field input:focus) {
          box-shadow: 0 0 0 4px rgba(255,255,255,0.25);
        }

        :global(.dark-stepper) {
          display: inline-flex; align-items: stretch;
          background: rgba(255,255,255,0.95);
          border-radius: 12px;
          overflow: hidden;
          height: 50px;
          border: 1px solid rgba(255,255,255,0.65);
        }
        :global(.dark-stepper > button) {
          width: 44px;
          background: transparent;
          border: none;
          color: var(--ink);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: background 120ms;
        }
        :global(.dark-stepper > button:hover) { background: rgba(0,0,0,0.08); }
        :global(.dark-stepper input) {
          width: 56px;
          border: none;
          outline: none;
          background: transparent;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, monospace;
          color: var(--ink);
          font-feature-settings: 'tnum';
          -moz-appearance: textfield;
        }
        :global(.dark-stepper input::-webkit-outer-spin-button),
        :global(.dark-stepper input::-webkit-inner-spin-button) {
          -webkit-appearance: none; margin: 0;
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
