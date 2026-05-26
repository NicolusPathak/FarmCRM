// app/api/orders/search/route.ts — Server-side order search.
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { searchOrders } from '@/lib/db';
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
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const q       = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200);
    const fromIso = boundaryIso(req.nextUrl.searchParams.get('from'), false);
    const toIso   = boundaryIso(req.nextUrl.searchParams.get('to'),   true);
    const orders  = await searchOrders(q, { fromIso, toIso });
    return NextResponse.json({ orders });
  } catch (err) {
    return safeError(err, 'Search failed.', 'GET /api/orders/search');
  }
}
