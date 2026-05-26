// app/api/admin/products/route.ts — Admin: list catalog + update prices.
import { NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { listProducts } from '@/lib/products';
import { safeError } from '@/lib/api-error';

export async function GET() {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;
  try {
    const products = await listProducts();
    return NextResponse.json({ products });
  } catch (err) {
    return safeError(err, 'Could not load products.', 'GET /api/admin/products');
  }
}
