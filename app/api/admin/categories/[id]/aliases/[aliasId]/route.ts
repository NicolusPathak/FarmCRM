// app/api/admin/categories/[id]/aliases/[aliasId]/route.ts — Remove an alias.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

interface RouteParams { params: Promise<{ id: string; aliasId: string }> }

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id, aliasId } = await params;
  try {
    const sb = createSupabaseAdminClient();
    const { data: existing } = await sb
      .from('category_aliases')
      .select('id, alias, category_id')
      .eq('id', aliasId)
      .eq('category_id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Alias not found.' }, { status: 404 });

    const { error } = await sb.from('category_aliases').delete().eq('id', aliasId);
    if (error) return safeError(error, 'Could not remove alias.', 'DELETE /api/admin/categories/[id]/aliases/[aliasId]');

    await logAudit({
      actor: auth.user,
      action: 'updated',
      entity_type: 'category',
      entity_id: id,
      changes: { alias_removed: (existing as any).alias },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeError(err, 'Could not remove alias.', 'DELETE /api/admin/categories/[id]/aliases/[aliasId]');
  }
}
