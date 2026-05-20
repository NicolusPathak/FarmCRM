'use client';
import { useState } from 'react';
import { useLoadingAction, useLoadingRouter } from '@/components/ui/GlobalLoading';
import toast from 'react-hot-toast';
import { Plus, X, Loader2, Trash2, Pencil, Check, Tag } from 'lucide-react';
import type { CategoryWithAliases, CategoryAlias } from '@/types';

interface Props { initial: CategoryWithAliases[] }

const DEFAULT_COLORS = [
  '#b0322b', '#d97706', '#0891b2', '#16a34a', '#7c3aed', '#db2777', '#64748b',
];

export default function CategoriesClient({ initial }: Props) {
  const router = useLoadingRouter();
  const withLoading = useLoadingAction();
  const [list, setList] = useState<CategoryWithAliases[]>(initial);

  // New-category form
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);
  const [creating, setCreating] = useState(false);

  // Inline edit state (one row at a time)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#64748b');
  const [savingEdit, setSavingEdit] = useState(false);

  // Per-row alias input state
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({});
  const [aliasSaving, setAliasSaving] = useState<string | null>(null);
  const [removingAlias, setRemovingAlias] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return toast.error('Name is required');
    setCreating(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/admin/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), color: newColor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed');
        setList(l => [...l, data]);
        setNewName('');
        toast.success('Category added');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setCreating(false);
      }
    });
  }

  function startEdit(c: CategoryWithAliases) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditName('');
  }
  async function commitEdit(id: string) {
    if (!editName.trim()) return toast.error('Name cannot be empty');
    setSavingEdit(true);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/admin/categories/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName.trim(), color: editColor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed');
        setList(l => l.map(c => c.id === id ? { ...c, name: data.name, color: data.color } : c));
        toast.success('Updated');
        cancelEdit();
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSavingEdit(false);
      }
    });
  }

  async function archive(id: string, name: string) {
    if (!confirm(`Archive "${name}"? Items previously bucketed into this category will become uncategorized on the next report.`)) return;
    setArchiving(id);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
        setList(l => l.filter(c => c.id !== id));
        toast.success(`"${name}" archived`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setArchiving(null);
      }
    });
  }

  async function addAlias(id: string) {
    const text = (aliasDraft[id] ?? '').trim();
    if (!text) return;
    setAliasSaving(id);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/admin/categories/${id}/aliases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed');
        setList(l => l.map(c => c.id === id ? { ...c, aliases: [...c.aliases, data as CategoryAlias] } : c));
        setAliasDraft(d => ({ ...d, [id]: '' }));
        toast.success('Alias added');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setAliasSaving(null);
      }
    });
  }

  async function removeAlias(categoryId: string, aliasId: string, label: string) {
    setRemovingAlias(aliasId);
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/admin/categories/${categoryId}/aliases/${aliasId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
        setList(l => l.map(c => c.id === categoryId
          ? { ...c, aliases: c.aliases.filter(a => a.id !== aliasId) }
          : c));
        toast.success(`Removed "${label}"`);
        router.refresh();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setRemovingAlias(null);
      }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780 }}>
      {/* Create */}
      <div className="card">
        <h2 style={{ fontFamily: 'var(--font-dm-serif), serif', fontSize: 18, margin: 0, marginBottom: 14 }}>
          New category
        </h2>
        <form onSubmit={createCategory} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label className="label" htmlFor="cat-name">Name</label>
            <input
              id="cat-name"
              className="input-field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Fish"
              disabled={creating}
              maxLength={60}
            />
          </div>
          <div>
            <label className="label">Color</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {DEFAULT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  aria-label={`Pick color ${c}`}
                  style={{
                    width: 26, height: 26, borderRadius: 8, background: c,
                    border: newColor === c ? '2px solid var(--ink)' : '2px solid transparent',
                    cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={creating} style={{ padding: '10px 16px' }}>
            {creating ? <><Loader2 size={14} className="spin" /> Adding…</> : <><Plus size={14} /> Add category</>}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          Aliases are the words staff actually type. &ldquo;Goat&rdquo;, &ldquo;mutton&rdquo;, and &ldquo;bakra&rdquo; all bucket into the same category. Spelling errors within 1 character (e.g. &ldquo;chiken&rdquo; → &ldquo;chicken&rdquo;) are matched automatically.
        </p>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '40px 20px' }}>
          No categories yet. Add one above to start bucketing items.
        </div>
      ) : (
        list.map(c => {
          const isEditing = editingId === c.id;
          return (
            <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: isEditing ? editColor : c.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff',
                }}>
                  <Tag size={16} strokeWidth={2} />
                </div>
                {isEditing ? (
                  <>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      maxLength={60}
                      style={{
                        flex: 1, minWidth: 120,
                        padding: '8px 10px', fontSize: 15, fontWeight: 600,
                        border: '1px solid var(--border)', borderRadius: 8,
                        fontFamily: 'inherit',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {DEFAULT_COLORS.map(col => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setEditColor(col)}
                          aria-label={`Pick color ${col}`}
                          style={{
                            width: 22, height: 22, borderRadius: 6, background: col,
                            border: editColor === col ? '2px solid var(--ink)' : '2px solid transparent',
                            cursor: 'pointer', padding: 0,
                          }}
                        />
                      ))}
                    </div>
                    <button onClick={() => commitEdit(c.id)} disabled={savingEdit} className="btn-primary"
                            style={{ padding: '6px 10px', fontSize: 12.5 }}>
                      {savingEdit ? <Loader2 size={12} className="spin" /> : <Check size={13} />}
                    </button>
                    <button onClick={cancelEdit} disabled={savingEdit} className="btn-ghost"
                            style={{ padding: '6px 8px' }}>
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                    <button onClick={() => startEdit(c)} className="btn-ghost" style={{ padding: '5px 9px', fontSize: 12.5 }}>
                      <Pencil size={12} /> Edit
                    </button>
                    <button onClick={() => archive(c.id, c.name)} disabled={archiving === c.id}
                            className="btn-ghost" style={{ color: 'var(--danger)', padding: '5px 9px', fontSize: 12.5 }}>
                      {archiving === c.id ? <Loader2 size={12} className="spin" /> : <><Trash2 size={12} /> Archive</>}
                    </button>
                  </>
                )}
              </div>

              {/* Aliases */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {c.aliases.length === 0 && (
                  <span style={{ fontSize: 12.5, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                    No aliases yet — add one so items get matched.
                  </span>
                )}
                {c.aliases.map(a => (
                  <span key={a.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px 4px 10px', borderRadius: 999,
                    background: 'var(--surface-2)', color: 'var(--ink)',
                    fontSize: 12.5, fontWeight: 500,
                  }}>
                    {a.alias}
                    <button
                      onClick={() => removeAlias(c.id, a.id, a.alias)}
                      disabled={removingAlias === a.id}
                      aria-label={`Remove alias ${a.alias}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 16, height: 16, borderRadius: '50%', border: 'none',
                        background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', padding: 0,
                      }}
                    >
                      {removingAlias === a.id ? <Loader2 size={10} className="spin" /> : <X size={11} />}
                    </button>
                  </span>
                ))}
              </div>

              {/* Add alias */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={aliasDraft[c.id] ?? ''}
                  onChange={(e) => setAliasDraft(d => ({ ...d, [c.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(c.id); } }}
                  placeholder="Add alias (e.g. goat head)"
                  className="input-field"
                  style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}
                  disabled={aliasSaving === c.id}
                  maxLength={60}
                />
                <button
                  onClick={() => addAlias(c.id)}
                  disabled={aliasSaving === c.id || !(aliasDraft[c.id]?.trim())}
                  className="btn-ghost"
                  style={{ padding: '8px 12px', fontSize: 12.5 }}
                >
                  {aliasSaving === c.id ? <Loader2 size={12} className="spin" /> : <><Plus size={12} /> Add</>}
                </button>
              </div>
            </div>
          );
        })
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
