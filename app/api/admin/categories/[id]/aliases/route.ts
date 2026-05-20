// app/api/admin/categories/[id]/aliases/route.ts — Add an alias to a category.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';
import { normalizeItemName } from '@/lib/categories';

const MAX_ALIAS = 60;

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const alias = String(body.alias ?? '').trim();
  if (!alias) return NextResponse.json({ error: 'Alias is required.' }, { status: 400 });
  if (alias.length > MAX_ALIAS) {
    return NextResponse.json({ error: `Alias too long (max ${MAX_ALIAS}).` }, { status: 400 });
  }
  const normalized = normalizeItemName(alias);
  if (!normalized) return NextResponse.json({ error: 'Alias must contain letters or numbers.' }, { status: 400 });

  try {
    const sb = createSupabaseAdminClient();

    const { data: cat } = await sb
      .from('product_categories')
      .select('id, name, archived_at')
      .eq('id', id)
      .maybeSingle();
    if (!cat || (cat as any).archived_at) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }

    const { data, error } = await sb
      .from('category_aliases')
      .insert({ category_id: id, alias, alias_normalized: normalized } as any)
      .select('id, category_id, alias, alias_normalized, created_at')
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        // Another category already claims this normalized alias.
        const { data: clash } = await sb
          .from('category_aliases')
          .select('category_id, product_categories(name)')
          .eq('alias_normalized', normalized)
          .maybeSingle();
        const otherName = (clash as any)?.product_categories?.name ?? 'another category';
        return NextResponse.json(
          { error: `"${alias}" is already an alias for ${otherName}.` },
          { status: 409 },
        );
      }
      return safeError(error, 'Could not add alias.', 'POST /api/admin/categories/[id]/aliases');
    }

    await logAudit({
      actor: auth.user,
      action: 'updated',
      entity_type: 'category',
      entity_id: id,
      entity_label: (cat as any).name,
      changes: { alias_added: alias, normalized },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return safeError(err, 'Could not add alias.', 'POST /api/admin/categories/[id]/aliases');
  }
}
