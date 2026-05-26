'use client';
import { useMemo, useState } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { Save, Loader2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product } from '@/types';

interface Props { initial: Product[] }

interface DraftRow {
  product: Product;
  price: string;
  fee: string;
  accent: string;
}

function fromProduct(p: Product): DraftRow {
  return {
    product: p,
    price: Number(p.default_price).toFixed(2),
    fee: Number(p.service_fee).toFixed(2),
    accent: p.accent_color || '#0F172A',
  };
}

const unitLabel = (u: Product['unit']) => (u === 'each' ? 'each' : u === 'lb' ? 'lb' : 'tray');

export default function ProductsClient({ initial }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [rows,   setRows]   = useState<DraftRow[]>(() => initial.map(fromProduct));
  const [saving, setSaving] = useState<string | null>(null);

  // Group rows by their group_code so the screen mirrors the order screen's
  // catalog cards — admin sees the same mental model.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: DraftRow[] }>();
    for (const r of rows) {
      const g = map.get(r.product.group_code);
      if (g) g.rows.push(r);
      else map.set(r.product.group_code, { label: r.product.group_label, rows: [r] });
    }
    return Array.from(map.entries()).map(([code, v]) => ({ code, ...v }));
  }, [rows]);

  function setField(id: string, key: 'price' | 'fee' | 'accent', v: string) {
    setRows((rs) => rs.map((r) => (r.product.id === id ? { ...r, [key]: v } : r)));
  }

  function isDirty(r: DraftRow): boolean {
    return (
      Number(r.price) !== Number(r.product.default_price) ||
      Number(r.fee)   !== Number(r.product.service_fee)   ||
      r.accent.toLowerCase() !== (r.product.accent_color || '').toLowerCase()
    );
  }

  async function save(r: DraftRow) {
    setSaving(r.product.id);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/admin/products/${r.product.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            default_price: Number(r.price),
            service_fee:   Number(r.fee),
            accent_color:  r.accent,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        setRows((rs) => rs.map((row) => (row.product.id === r.product.id ? fromProduct(data as Product) : row)));
        toast.success(`${data.name}: saved`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSaving(null);
      }
    });
  }

  return (
    <div className="wrap">
      <div className="hint-banner">
        <Check size={14} />
        <span>
          Changes take effect immediately for <strong>new orders</strong>.
          Existing orders keep the price they were saved at.
        </span>
      </div>

      {groups.map((g) => (
        <section key={g.code} className="group">
          <div className="group__header">
            <h2 className="group__title">{g.label}</h2>
            <span className="group__count">{g.rows.length} product{g.rows.length === 1 ? '' : 's'}</span>
          </div>

          <div className="group__list">
            {g.rows.map((r) => {
              const dirty = isDirty(r);
              const busy  = saving === r.product.id;
              const showFee = r.product.code === 'whole_goat' || Number(r.product.service_fee) > 0;
              return (
                <div key={r.product.id} className="prod-row">
                  <div className="prod-row__head">
                    <label
                      className="swatch"
                      style={{ background: r.accent }}
                      title="Card color on the order screen"
                    >
                      <input
                        type="color"
                        value={r.accent}
                        onChange={(e) => setField(r.product.id, 'accent', e.target.value)}
                      />
                    </label>
                    <div className="prod-row__name">{r.product.name}</div>
                    <code className="prod-row__code">{r.product.code}</code>
                  </div>

                  <div className="prod-row__fields">
                    <label className="field">
                      <span className="field__label">Price · per {unitLabel(r.product.unit)}</span>
                      <div className="money-input">
                        <span>$</span>
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={r.price}
                          onChange={(e) => setField(r.product.id, 'price', e.target.value)}
                        />
                      </div>
                    </label>

                    <label className={`field${showFee ? '' : ' field--disabled'}`}>
                      <span className="field__label">Service fee · per unit</span>
                      <div className="money-input">
                        <span>$</span>
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={r.fee}
                          disabled={!showFee && Number(r.fee) === 0}
                          onChange={(e) => setField(r.product.id, 'fee', e.target.value)}
                        />
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() => save(r)}
                      disabled={!dirty || busy}
                      className="btn-primary prod-row__save"
                    >
                      {busy
                        ? <><Loader2 size={13} className="spin" /> Saving</>
                        : <><Save size={13} /> {dirty ? 'Save' : 'Saved'}</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .wrap {
          max-width: 880px;
          display: flex; flex-direction: column; gap: 18px;
        }

        .hint-banner {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--success-bg);
          border: 1px solid #C9E6D5;
          color: var(--success);
          font-size: 13px;
        }
        .hint-banner strong { color: var(--success); }

        .group {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: var(--shadow-sm);
          overflow: hidden;
        }
        .group__header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 22px;
          background: var(--surface-2);
          border-bottom: 1px solid var(--border);
        }
        .group__title {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: var(--ink);
        }
        .group__count {
          font-size: 11.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-muted);
        }
        .group__list { display: flex; flex-direction: column; }

        .prod-row {
          display: flex; flex-direction: column; gap: 12px;
          padding: 16px 22px;
          border-top: 1px solid var(--border-soft);
        }
        .prod-row:first-child { border-top: none; }

        .prod-row__head {
          display: flex; align-items: center; gap: 10px;
        }

        .swatch {
          width: 22px; height: 22px;
          border-radius: 8px;
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,0.08),
            0 2px 6px rgba(22,19,17,0.15);
          cursor: pointer;
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }
        .swatch input {
          position: absolute;
          inset: 0;
          opacity: 0;
          width: 100%; height: 100%;
          cursor: pointer;
          border: none; padding: 0; margin: 0;
        }
        .prod-row__name {
          font-size: 14.5px; font-weight: 600;
          color: var(--ink);
        }
        .prod-row__code {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 11.5px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--surface-2);
          color: var(--ink-muted);
          border: 1px solid var(--border-soft);
        }

        .prod-row__fields {
          display: grid;
          grid-template-columns: 1fr 1fr 130px;
          gap: 12px;
          align-items: end;
        }

        .field { display: flex; flex-direction: column; gap: 5px; }
        .field--disabled { opacity: 0.55; }
        .field__label {
          font-size: 10.5px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--ink-muted);
        }

        .money-input {
          display: flex; align-items: center;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0 12px 0 14px;
          transition: border-color 140ms, box-shadow 140ms;
        }
        .money-input:focus-within {
          border-color: var(--ink);
          box-shadow: 0 0 0 4px rgba(26,23,21,0.07);
        }
        .money-input > span {
          color: var(--ink-muted);
          font-size: 13px; font-weight: 600;
          margin-right: 4px;
        }
        .money-input input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          padding: 11px 0;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 14px;
          text-align: right;
          color: var(--ink);
          font-feature-settings: 'tnum';
          -moz-appearance: textfield;
        }
        .money-input input::-webkit-outer-spin-button,
        .money-input input::-webkit-inner-spin-button {
          -webkit-appearance: none; margin: 0;
        }
        .money-input input:disabled { color: var(--ink-faint); }

        .prod-row__save {
          padding: 11px 14px; font-size: 13px;
          min-height: 44px;
        }

        @media (max-width: 767px) {
          .prod-row__fields {
            grid-template-columns: 1fr 1fr;
          }
          .prod-row__save {
            grid-column: 1 / -1;
          }
        }
      `}</style>
    </div>
  );
}
