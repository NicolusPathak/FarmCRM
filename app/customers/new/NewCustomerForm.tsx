'use client';
import { useRef, useState } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { ArrowRight, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';

const EMPTY = { full_name: '', phone_number: '', street: '', city: '', zip_code: '' };

type NextAction = 'order' | 'customer';

export default function NewCustomerForm() {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [form,   setForm]   = useState(EMPTY);
  const [saving, setSaving] = useState<NextAction | null>(null);
  const [error,  setError]  = useState('');
  // Defaults to 'order' so pressing Enter takes the most common path
  // (creating a customer in order to write an order).
  const nextAction = useRef<NextAction>('order');

  const set = (k: keyof typeof EMPTY, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Full name is required.'); return; }
    const action = nextAction.current;
    setSaving(action); setError('');
    await withLoading(async () => {
      try {
        const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        const d   = await res.json();
        if (!res.ok) throw new Error(d.error ?? 'Failed');
        toast.success(`Customer ${d.customer_number} created`);
        router.push(action === 'order' ? `/orders/new?customer=${d.id}` : `/customers/${d.id}`);
      } catch (err: any) { setError(err.message); setSaving(null); }
    });
  }

  return (
    <div style={{ maxWidth: 540 }}>
      <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">Full name <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input-field" placeholder="e.g. Asha Verma" value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
        </div>

        <div>
          <label className="label">Phone number</label>
          <input className="input-field" type="tel" placeholder="(817) 555-0101" value={form.phone_number} onChange={e => set('phone_number', e.target.value)} />
        </div>

        <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }} />
        <p className="label" style={{ marginBottom: 0 }}>Address (optional)</p>

        <div>
          <label className="label">Street</label>
          <input className="input-field" placeholder="412 Oak Hollow Dr" value={form.street} onChange={e => set('street', e.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
          <div>
            <label className="label">City</label>
            <input className="input-field" placeholder="Haslet" value={form.city} onChange={e => set('city', e.target.value)} />
          </div>
          <div>
            <label className="label">ZIP</label>
            <input className="input-field" placeholder="76052" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} />
          </div>
        </div>

        {error && (
          <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, fontWeight: 500, border: '1px solid var(--danger-soft)' }}>
            {error}
          </div>
        )}

        <div className="new-customer-actions">
          <button
            type="submit"
            onClick={() => { nextAction.current = 'order'; }}
            disabled={saving !== null}
            className="btn-primary new-customer-actions__primary"
          >
            {saving === 'order'
              ? <><Loader2 size={14} className="spin" /> Saving…</>
              : <><ArrowRight size={14} /> Save & Create Order</>}
          </button>
          <div className="new-customer-actions__row">
            <button
              type="submit"
              onClick={() => { nextAction.current = 'customer'; }}
              disabled={saving !== null}
              className="btn-secondary new-customer-actions__save"
            >
              {saving === 'customer'
                ? <><Loader2 size={14} className="spin" /> Saving…</>
                : <><UserPlus size={14} /> Save customer only</>}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              disabled={saving !== null}
              className="btn-secondary new-customer-actions__cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .new-customer-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 4px;
        }
        .new-customer-actions__primary { width: 100%; padding: 12px; }
        .new-customer-actions__row {
          display: flex;
          gap: 10px;
        }
        .new-customer-actions__save { flex: 1; padding: 12px; }
        .new-customer-actions__cancel { padding: 12px 18px; }
        /* On the smallest phones, stack everything so each tap target gets
           the full width and there's no risk of mis-tap between Save and Cancel. */
        @media (max-width: 380px) {
          .new-customer-actions__row { flex-direction: column; }
          .new-customer-actions__cancel { width: 100%; padding: 12px; }
        }
      `}</style>
    </div>
  );
}
