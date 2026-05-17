// app/api/retention/route.ts — Admin-only retention concerns
import { NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { computeRetention } from '@/lib/retention';

export async function GET() {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;
  const result = await computeRetention();
  return NextResponse.json(result);
}
