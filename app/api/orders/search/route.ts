// app/api/orders/search/route.ts — Server-side order search.
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { searchOrders } from '@/lib/db';
import { safeError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200);
    const orders = await searchOrders(q);
    return NextResponse.json({ orders });
  } catch (err) {
    return safeError(err, 'Search failed.', 'GET /api/orders/search');
  }
}
