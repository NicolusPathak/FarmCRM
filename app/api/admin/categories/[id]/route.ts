// app/api/admin/categories/[id]/route.ts — Rename, recolor, or archive a category.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit, diffFields } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME = 60;

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    if (n.length > MAX_NAME) return NextResponse.json({ error: `Name too long (max ${MAX_NAME}).` }, { status: 400 });
    patch.name = n;
  }
  if (typeof body.color === 'string') {
    if (!COLOR_RE.test(body.color)) return NextResponse.json({ error: 'Color must be hex (e.g. #b0322b).' }, { status: 400 });
    patch.color = body.color;
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'sort_order must be a number.' }, { status: 400 });
    patch.sort_order = Math.floor(n);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  try {
    const sb = createSupabaseAdminClient();

    const { data: before } = await sb
      .from('product_categories')
      .select('id, name, color, sort_order, archived_at')
      .eq('id', id)
      .maybeSingle();
    if (!before || (before as any).archived_at) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await sb
      .from('product_categories')
      .update(patch as any)
      .eq('id', id)
      .select('id, name, color, sort_order, archived_at, created_at, updated_at')
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'Another category already has that name.' }, { status: 409 });
      }
      return safeError(error, 'Could not update category.', 'PATCH /api/admin/categories/[id]');
    }

    await logAudit({
      actor: auth.user,
      action: 'updated',
      entity_type: 'category',
      entity_id: id,
      entity_label: (data as any).name,
      changes: diffFields(before as any, patch as any, ['name', 'color', 'sort_order']),
    });

    return NextResponse.json(data);
  } catch (err) {
    return safeError(err, 'Could not update category.', 'PATCH /api/admin/categories/[id]');
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const sb = createSupabaseAdminClient();

    const { data: before } = await sb
      .from('product_categories')
      .select('id, name, archived_at')
      .eq('id', id)
      .maybeSingle();
    if (!before || (before as any).archived_at) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }

    const { error } = await sb
      .from('product_categories')
      .update({ archived_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) return safeError(error, 'Could not archive category.', 'DELETE /api/admin/categories/[id]');

    await logAudit({
      actor: auth.user,
      action: 'archived',
      entity_type: 'category',
      entity_id: id,
      entity_label: (before as any).name,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeError(err, 'Could not archive category.', 'DELETE /api/admin/categories/[id]');
  }
}
