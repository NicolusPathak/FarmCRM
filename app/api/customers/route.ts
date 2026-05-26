// app/api/customers/route.ts — GET lists customers (paginated), POST creates one
import { NextRequest } from 'next/server';
import { apiSession } from '@/lib/auth';
import { createCustomer, listCustomers } from '@/lib/db';
import { safeError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 50), 200);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0), 0);
    const { customers, total } = await listCustomers({ offset, limit });
    return Response.json({ customers, total });
  } catch (err) {
    return safeError(err, 'Could not load customers.', 'GET /api/customers');
  }
}

export async function POST(req: NextRequest) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const customer = await createCustomer(body, auth.user);
    return Response.json(customer, { status: 201 });
  } catch (err) {
    return safeError(err, 'Could not create customer.', 'POST /api/customers');
  }
}
