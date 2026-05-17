// app/api/customers/search/route.ts — Fast customer search endpoint
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { searchCustomers } from '@/lib/db';
import { safeError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200);
    const customers = await searchCustomers(q);
    return NextResponse.json({ customers });
  } catch (err) {
    return safeError(err, 'Search failed.', 'GET /api/customers/search');
  }
}
