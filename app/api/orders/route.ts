// app/api/orders/route.ts — GET lists orders (paginated), POST creates one
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { createOrder, listOrders } from '@/lib/db';
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
    const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 50), 200);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0), 0);
    const fromIso = boundaryIso(req.nextUrl.searchParams.get('from'), false);
    const toIso   = boundaryIso(req.nextUrl.searchParams.get('to'),   true);

    const { orders, total } = await listOrders({ offset, limit, fromIso, toIso });
    return NextResponse.json({ orders, total });
  } catch (err) {
    return safeError(err, 'Could not load orders.', 'GET /api/orders');
  }
}

export async function POST(req: NextRequest) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const order = await createOrder(body, auth.user);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    return safeError(err, 'Could not create order.', 'POST /api/orders');
  }
}
