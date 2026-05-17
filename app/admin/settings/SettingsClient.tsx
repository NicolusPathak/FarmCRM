'use client';
import { useState } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import { Save, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { RetentionSettings } from '@/lib/retention-types';
import { DEFAULT_SETTINGS } from '@/lib/retention-types';

interface Field {
  key: keyof RetentionSettings;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: Field[] = [
  { key: 'cold_days',               label: 'Cold-customer threshold (days)',  hint: 'Customers with ≥2 orders flagged when they haven\'t returned in this many days.', min: 7,  max: 365, step: 1   },
  { key: 'one_time_days',           label: 'One-time-only threshold (days)',  hint: 'Customers with a single order flagged after this many days of silence.',          min: 7,  max: 365, step: 1   },
  { key: 'slipping_avg_gap_cap',    label: 'Regular cadence ceiling (days)',  hint: 'Only customers whose typical gap is under this count as "regulars" for slipping detection.', min: 3, max: 120, step: 1 },
  { key: 'slipping_multiplier',     label: 'Slipping multiplier',             hint: 'Flagged once they\'ve gone this many times longer than their typical gap. 1.75 = 75% over.', min: 1.1, max: 5, step: 0.05 },
  { key: 'contacted_suppress_days', label: 'Hide-after-contact (days)',       hint: 'How long a customer disappears from the list after you mark them contacted.',     min: 0,  max: 90,  step: 1   },
];

interface Props {
  initial: RetentionSettings;
  lastUpdatedAt: string | null;
  lastUpdatedName: string | null;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SettingsClient({ initial, lastUpdatedAt, lastUpdatedName }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [values, setValues] = useState<RetentionSettings>(initial);
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(values) as (keyof RetentionSettings)[]).some(k => values[k] !== initial[k]);

  function set(k: keyof RetentionSettings, v: string) {
    const n = Number(v);
    setValues(s => ({ ...s, [k]: Number.isFinite(n) ? n : s[k] }));
  }

  async function save() {
    setSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retention: values }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        setValues(data.retention);
        toast.success('Settings saved');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
    });
  }

  function reset() {
    setValues(DEFAULT_SETTINGS);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: '-0.005em' }}>Retention thresholds</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 3 }}>
            These rules decide which customers appear under Retention concerns.
          </div>
        </div>

        <div>
          {FIELDS.map((f, i) => (
            <div key={f.key} style={{
              display: 'grid', gridTemplateColumns: '1fr 130px',
              alignItems: 'center', gap: 16,
              padding: '14px 20px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border-soft)',
            }}>
              <div>
                <label htmlFor={f.key} style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{f.label}</label>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.45 }}>{f.hint}</div>
              </div>
              <input
                id={f.key}
                className="input-field"
                type="number"
                min={f.min} max={f.max} step={f.step}
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                style={{ textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
              />
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <button onClick={reset} className="btn-ghost" style={{ padding: '8px 12px' }} disabled={saving}>
            <RotateCcw size={13} /> Reset to defaults
          </button>
          <button onClick={save} disabled={!dirty || saving} className="btn-primary">
            {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save changes</>}
          </button>
        </div>
      </div>

      {/* Last-changed footer. Stays outside the card so the card itself
          remains tidy. Shows whoever the FK still points at; archived
          actors fall back to "—" because the FK is ON DELETE SET NULL. */}
      {lastUpdatedAt && (
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12, textAlign: 'right' }}>
          Last changed
          {lastUpdatedName ? <> by <strong style={{ color: 'var(--ink-2)' }}>{lastUpdatedName}</strong></> : null}
          {' '}on {formatStamp(lastUpdatedAt)}.
        </p>
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
