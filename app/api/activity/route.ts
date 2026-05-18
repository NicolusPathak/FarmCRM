// app/api/activity/route.ts — Admin-only: paginated audit log.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { safeError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  try {
    const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 50), 200);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0), 0);
    const entityType = req.nextUrl.searchParams.get('entity_type');

    const sb = createSupabaseAdminClient();
    let query = sb
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (entityType) query = query.eq('entity_type', entityType);

    const { data, error, count } = await query;
    if (error) return safeError(error, 'Could not load activity.', 'GET /api/activity');

    return NextResponse.json({ entries: data ?? [], total: count ?? 0 });
  } catch (err) {
    return safeError(err, 'Could not load activity.', 'GET /api/activity');
  }
}
