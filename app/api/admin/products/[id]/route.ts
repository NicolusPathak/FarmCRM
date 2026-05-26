// app/api/admin/products/[id]/route.ts — Admin: update one product's default price + service fee.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { listProducts, updateProduct } from '@/lib/products';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as any));

  try {
    // Snapshot before-state so we can attach a clean diff to the audit log.
    const before = (await listProducts()).find((p) => p.id === id);
    if (!before) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

    const after = await updateProduct(id, {
      default_price: body.default_price,
      service_fee: body.service_fee,
      accent_color: body.accent_color,
    });

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (before.default_price !== after.default_price) {
      changes.default_price = { from: before.default_price, to: after.default_price };
    }
    if (before.service_fee !== after.service_fee) {
      changes.service_fee = { from: before.service_fee, to: after.service_fee };
    }
    if (before.accent_color !== after.accent_color) {
      changes.accent_color = { from: before.accent_color, to: after.accent_color };
    }

    if (Object.keys(changes).length > 0) {
      await logAudit({
        actor: auth.user,
        action: 'updated',
        entity_type: 'settings',
        entity_label: `Product: ${after.name}`,
        changes,
      });
    }

    return NextResponse.json(after);
  } catch (err) {
    return safeError(err, 'Could not update product.', `PUT /api/admin/products/${id}`);
  }
}
