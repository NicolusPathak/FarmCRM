// app/api/orders/route.ts — POST creates a new order
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { createOrder } from '@/lib/db';
import { safeError } from '@/lib/api-error';

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
