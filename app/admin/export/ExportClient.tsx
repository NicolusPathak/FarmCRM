'use client';
import { useState } from 'react';
import { Download, Users, Receipt, Activity, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props { defaultFrom: string; defaultTo: string }

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isValidRange(from: string, to: string): boolean {
  if (!YYYY_MM_DD.test(from) || !YYYY_MM_DD.test(to)) return false;
  if (from > to) return false;
  const ms = (s: string) => Date.parse(s + 'T00:00:00Z');
  const days = (ms(to) - ms(from)) / 86_400_000;
  return days <= 366;
}

// Derive a filename from the response's Content-Disposition, falling back
// to a sensible default. Browsers normally do this themselves; we have to
// since we're saving from a Blob.
function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename="([^"]+)"/.exec(cd);
  return m?.[1] ?? fallback;
}

export default function ExportClient({ defaultFrom, defaultTo }: Props) {
  const [ordersFrom,  setOrdersFrom]  = useState(defaultFrom);
  const [ordersTo,    setOrdersTo]    = useState(defaultTo);
  const [auditFrom,   setAuditFrom]   = useState(defaultFrom);
  const [auditTo,     setAuditTo]     = useState(defaultTo);

  // Per-section "Downloading…" gate. Locks the button precisely until the
  // download settles (or fails) — no 5-second guesswork.
  const [pending, setPending] = useState<null | 'customers' | 'orders' | 'audit'>(null);

  // fetch → check ok → blob → trigger download via temporary <a>. If the
  // server returns 4xx/5xx, the body is usually JSON `{ error }`; surface
  // that as a toast instead of saving an error-JSON file the admin would
  // open in Excel and stare at.
  async function go(which: 'customers' | 'orders' | 'audit', url: string, fallbackName: string) {
    if (pending) return;
    setPending(which);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        // Try to read a JSON error body — server may have streamed plain
        // text in extreme cases, so guard the parse.
        let msg = `Export failed (${res.status}).`;
        try {
          const ct = res.headers.get('Content-Type') ?? '';
          if (ct.includes('application/json')) {
            const body = await res.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* keep default */ }
        toast.error(msg);
        return;
      }

      const blob = await res.blob();
      const name = filenameFrom(res, fallbackName);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Free the blob URL on the next tick so the click has time to fire.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
      toast.success(`Downloaded ${name}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not download.');
    } finally {
      setPending(null);
    }
  }

  const ordersOk = isValidRange(ordersFrom, ordersTo);
  const auditOk  = isValidRange(auditFrom,  auditTo);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <Section
        title="All customers"
        Icon={Users}
        help="Opens in Excel / Google Sheets. Includes every active (non-deleted) customer."
      >
        <button
          className="btn-primary"
          disabled={pending !== null}
          onClick={() => go('customers', '/api/export/customers.csv', 'customers.csv')}
        >
          {pending === 'customers'
            ? <><Loader2 size={14} className="spin" /> Downloading…</>
            : <><Download size={14} /> Download customers CSV</>}
        </button>
      </Section>

      <Section
        title="Orders"
        Icon={Receipt}
        help="One row per order line item. Includes voided orders so you can reconcile."
      >
        <Range from={ordersFrom} to={ordersTo} setFrom={setOrdersFrom} setTo={setOrdersTo} />
        <button
          className="btn-primary"
          disabled={pending !== null || !ordersOk}
          onClick={() => go('orders', `/api/export/orders.csv?from=${ordersFrom}&to=${ordersTo}`, `orders_${ordersFrom}_to_${ordersTo}.csv`)}
        >
          {pending === 'orders'
            ? <><Loader2 size={14} className="spin" /> Downloading…</>
            : <><Download size={14} /> Download orders CSV</>}
        </button>
        {!ordersOk && <RangeError />}
      </Section>

      <Section
        title="Audit log"
        Icon={Activity}
        help="Every customer/order/PIN change with actor + IP."
      >
        <Range from={auditFrom} to={auditTo} setFrom={setAuditFrom} setTo={setAuditTo} />
        <button
          className="btn-primary"
          disabled={pending !== null || !auditOk}
          onClick={() => go('audit', `/api/export/audit.csv?from=${auditFrom}&to=${auditTo}`, `audit_${auditFrom}_to_${auditTo}.csv`)}
        >
          {pending === 'audit'
            ? <><Loader2 size={14} className="spin" /> Downloading…</>
            : <><Download size={14} /> Download audit CSV</>}
        </button>
        {!auditOk && <RangeError />}
      </Section>

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Section({ title, Icon, help, children }: { title: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; help: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} strokeWidth={1.8} />
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: '-0.005em' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{help}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        From
        <input type="date" className="input-field" style={{ width: 160, padding: '8px 10px' }}
          value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        To
        <input type="date" className="input-field" style={{ width: 160, padding: '8px 10px' }}
          value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </>
  );
}

function RangeError() {
  return (
    <span style={{ fontSize: 12, color: 'var(--danger)' }}>
      Pick a valid range (from on or before to, 366 days max).
    </span>
  );
}
