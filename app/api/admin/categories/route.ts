// app/api/admin/categories/route.ts — Admin: list + create item categories.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';
import { loadCategoriesWithAliases } from '@/lib/report';
import { normalizeItemName } from '@/lib/categories';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME = 60;

export async function GET() {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;
  try {
    const categories = await loadCategoriesWithAliases();
    return NextResponse.json({ categories });
  } catch (err) {
    return safeError(err, 'Could not load categories.', 'GET /api/admin/categories');
  }
}

export async function POST(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as any));
  const name = String(body.name ?? '').trim();
  const color = String(body.color ?? '#64748b').trim();
  const sort_order = Number.isFinite(Number(body.sort_order))
    ? Math.floor(Number(body.sort_order))
    : 100;

  if (!name) return NextResponse.json({ error: 'Category name is required.' }, { status: 400 });
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Name too long (max ${MAX_NAME}).` }, { status: 400 });
  }
  if (!COLOR_RE.test(color)) {
    return NextResponse.json({ error: 'Color must be a 7-char hex code (e.g. #b0322b).' }, { status: 400 });
  }

  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from('product_categories')
      .insert({ name, color, sort_order } as any)
      .select('id, name, color, sort_order, archived_at, created_at, updated_at')
      .single();

    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'A category with that name already exists.' }, { status: 409 });
      }
      return safeError(error, 'Could not create category.', 'POST /api/admin/categories');
    }

    // Seed an alias from the category name itself so the new category
    // immediately matches any item that happens to be named the same.
    // Errors here are non-fatal — the admin can add aliases later.
    const aliasNorm = normalizeItemName(name);
    if (aliasNorm) {
      await sb.from('category_aliases').insert({
        category_id: (data as any).id,
        alias: name,
        alias_normalized: aliasNorm,
      } as any);
    }

    await logAudit({
      actor: auth.user,
      action: 'created',
      entity_type: 'category',
      entity_id: (data as any).id,
      entity_label: name,
      changes: { name, color, sort_order },
    });

    return NextResponse.json({ ...(data as any), aliases: [] }, { status: 201 });
  } catch (err) {
    return safeError(err, 'Could not create category.', 'POST /api/admin/categories');
  }
}
