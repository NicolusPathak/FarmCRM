// app/api/activity/route.ts — Admin-only: paginated audit log.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { safeError } from '@/lib/api-error';
import { shopDayBoundaryMs } from '@/lib/utils';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function boundaryIso(raw: string | null, endOfDay: boolean): string | null {
  if (!raw || !YYYY_MM_DD.test(raw)) return null;
  const ms = shopDayBoundaryMs(raw, endOfDay);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  try {
    const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 50), 200);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0), 0);
    const entityType = req.nextUrl.searchParams.get('entity_type');
    const fromIso = boundaryIso(req.nextUrl.searchParams.get('from'), false);
    const toIso   = boundaryIso(req.nextUrl.searchParams.get('to'),   true);

    const sb = createSupabaseAdminClient();
    let query = sb
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (entityType) query = query.eq('entity_type', entityType);
    if (fromIso)    query = query.gte('created_at', fromIso);
    if (toIso)      query = query.lte('created_at', toIso);

    const { data, error, count } = await query;
    if (error) return safeError(error, 'Could not load activity.', 'GET /api/activity');

    return NextResponse.json({ entries: data ?? [], total: count ?? 0 });
  } catch (err) {
    return safeError(err, 'Could not load activity.', 'GET /api/activity');
  }
}
