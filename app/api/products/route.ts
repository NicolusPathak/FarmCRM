// app/api/products/route.ts — GET the catalog used by the new-order UI.
// Any authenticated user can read; admins additionally see and can edit
// defaults via /api/admin/products.
import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { listProductGroups } from '@/lib/products';
import { safeError } from '@/lib/api-error';

export async function GET() {
  const auth = await apiSession();
  if (auth.error) return auth.error;
  try {
    const groups = await listProductGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    return safeError(err, 'Could not load products.', 'GET /api/products');
  }
}
