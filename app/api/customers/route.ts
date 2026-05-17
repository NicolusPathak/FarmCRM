// app/api/customers/route.ts — POST creates a new customer
import { NextRequest } from 'next/server';
import { apiSession } from '@/lib/auth';
import { createCustomer } from '@/lib/db';
import { safeError } from '@/lib/api-error';

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
