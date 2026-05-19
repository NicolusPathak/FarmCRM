'use client';
import { useState } from 'react';
import { useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import toast from 'react-hot-toast';
import { Plus, Loader2, ShieldCheck, KeyRound, X, Check, Pencil } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { StaffUser, StaffRole } from '@/types';

interface Props {
  initial: StaffUser[];
  currentUserId: string;
  // The role this page manages. Owner manages 'admin'; admin manages 'staff'.
  managedRole: StaffRole;
}

const PIN_LEN = 4;

export default function StaffClient({ initial, currentUserId, managedRole }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();

  const [list, setList] = useState<StaffUser[]>(initial);
  const [name, setName] = useState('');
  const [pin,  setPin]  = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Inline PIN-reset state: which row, and the new-PIN draft.
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPin,    setResetPin]    = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Inline rename state.
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [renameDraft,   setRenameDraft]   = useState('');
  const [renameSaving,  setRenameSaving]  = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    if (pin.length !== PIN_LEN) return toast.error(`PIN must be ${PIN_LEN} digits`);
    setSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), role: managedRole, pin }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to add');
        setList((l) => [data as StaffUser, ...l]);
        setName(''); setPin('');
        toast.success(`PIN created for ${data.name}`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
    });
  }

  async function revoke(id: string, displayName: string) {
    if (!confirm(`Revoke ${displayName}'s PIN? They will no longer be able to sign in.`)) return;
    setRevoking(id);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
        setList((l) => l.filter((s) => s.id !== id));
        toast.success('PIN revoked');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setRevoking(null);
      }
    });
  }

  function startReset(id: string) { setResettingId(id); setResetPin(''); }
  function cancelReset()           { setResettingId(null); setResetPin(''); setResetSaving(false); }

  function startRename(id: string, currentName: string) {
    setRenamingId(id); setRenameDraft(currentName);
  }
  function cancelRename() {
    setRenamingId(null); setRenameDraft(''); setRenameSaving(false);
  }

  async function commitRename(id: string) {
    const next = renameDraft.trim();
    if (!next) return toast.error('Name is required');
    setRenameSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/staff/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: next }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Rename failed');
        setList((l) => l.map((s) => (s.id === id ? { ...s, name: next } : s)));
        toast.success('Name updated');
        cancelRename();
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
        setRenameSaving(false);
      }
    });
  }

  async function commitReset(id: string) {
    if (resetPin.length !== PIN_LEN) return toast.error(`PIN must be ${PIN_LEN} digits`);
    setResetSaving(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/staff/${id}/pin`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: resetPin }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Reset failed');
        toast.success('PIN reset');
        cancelReset();
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
        setResetSaving(false);
      }
    });
  }

  const roleLabel    = managedRole === 'admin' ? 'admin' : 'staff';
  const roleLabelCap = managedRole === 'admin' ? 'Admin' : 'Staff';
  const helpText = managedRole === 'admin'
    ? 'Admins can manage staff, see activity, delete customers, and import.'
    : 'Staff can create/edit customers, create orders, and void orders. They cannot delete customers or adjust points.';

  return (
    <div className="split-grid split-grid--wide">
      {/* New PIN card */}
      <div className="card">
        <h2 style={{ fontFamily: 'var(--font-dm-serif), serif', fontSize: 18, margin: 0, marginBottom: 16 }}>
          Create {managedRole === 'admin' ? 'an admin' : 'a staff'} PIN
        </h2>
        <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label" htmlFor="staff-name">Name</label>
            <input id="staff-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Asha" disabled={saving} />
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
            {helpText}
          </p>

          <div>
            <label className="label" htmlFor="staff-pin">{PIN_LEN}-digit PIN</label>
            <input
              id="staff-pin"
              className="input-field"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LEN))}
              placeholder={'•'.repeat(PIN_LEN)}
              disabled={saving}
              style={{ letterSpacing: '0.4em', fontFamily: 'monospace' }}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={saving} style={{ padding: '11px 0' }}>
            {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Plus size={14} /> Create PIN</>}
          </button>
        </form>
      </div>

      {/* List card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            Active {roleLabel} PIN{list.length === 1 ? '' : 's'}{' '}
            <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>· {list.length}</span>
          </span>
        </div>

        {list.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13.5 }}>
            No {roleLabel} PINs yet — create one so {managedRole === 'admin' ? 'an admin' : 'a staff member'} can sign in.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const isMe        = s.id === currentUserId;
                const isResetting = resettingId === s.id;
                const isRenaming  = renamingId === s.id;
                return (
                  <tr key={s.id} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 600 }}>
                      {isRenaming ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(s.id); }
                              else if (e.key === 'Escape') { cancelRename(); }
                            }}
                            disabled={renameSaving}
                            maxLength={80}
                            style={{
                              padding: '5px 8px', fontSize: 13, fontWeight: 600,
                              borderRadius: 8, border: '1px solid var(--border)',
                              fontFamily: 'inherit', width: 180,
                            }}
                          />
                          <button
                            onClick={() => commitRename(s.id)}
                            disabled={renameSaving || !renameDraft.trim()}
                            className="btn-primary"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            title="Save name"
                          >
                            {renameSaving ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                          </button>
                          <button
                            onClick={cancelRename}
                            disabled={renameSaving}
                            className="btn-ghost"
                            style={{ padding: '5px 6px', fontSize: 12 }}
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {s.name}
                          {!isMe && !isResetting && (
                            <button
                              onClick={() => startRename(s.id, s.name)}
                              className="btn-ghost"
                              style={{ padding: '2px 4px', color: 'var(--ink-muted)' }}
                              title="Rename"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={s.role === 'admin' ? 'badge badge-brand' : 'badge badge-neutral'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {s.role === 'admin' && <ShieldCheck size={11} />} {s.role}
                      </span>
                    </td>
                    <td style={{ color: 'var(--ink-muted)' }}>{formatDate(s.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isMe ? (
                        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>you</span>
                      ) : isResetting ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="tel"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            value={resetPin}
                            onChange={(e) => setResetPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LEN))}
                            placeholder={'•'.repeat(PIN_LEN)}
                            disabled={resetSaving}
                            style={{
                              width: 84, padding: '6px 8px', fontSize: 13,
                              borderRadius: 8, border: '1px solid var(--border)',
                              letterSpacing: '0.3em', fontFamily: 'monospace', textAlign: 'center',
                            }}
                          />
                          <button
                            onClick={() => commitReset(s.id)}
                            disabled={resetSaving || resetPin.length !== PIN_LEN}
                            className="btn-primary"
                            style={{ padding: '6px 10px', fontSize: 12.5 }}
                            title="Save new PIN"
                          >
                            {resetSaving ? <Loader2 size={12} className="spin" /> : <Check size={13} />}
                          </button>
                          <button
                            onClick={cancelReset}
                            disabled={resetSaving}
                            className="btn-ghost"
                            style={{ padding: '6px 8px', fontSize: 12.5 }}
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {/* Reset works for both owner (resetting admin PINs)
                              and admin (resetting their staff team's PINs). */}
                          <button onClick={() => startReset(s.id)}
                            className="btn-ghost" style={{ fontSize: 12.5, padding: '5px 10px' }}
                            title="Reset PIN">
                            <KeyRound size={12} /> Reset
                          </button>
                          <button onClick={() => revoke(s.id, s.name)} disabled={revoking === s.id}
                            className="btn-ghost" style={{ color: 'var(--danger)', fontSize: 12.5, padding: '5px 10px' }}>
                            {revoking === s.id ? <Loader2 size={12} className="spin" /> : 'Revoke'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {/* Footer hint */}
        <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--ink-muted)' }}>
          You are viewing {roleLabelCap.toLowerCase()} PINs only.
          {managedRole === 'admin'
            ? ' Each admin can manage their own team of staff from this page after signing in.'
            : ' Admin PINs are managed by the owner.'}
        </div>
      </div>
      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
