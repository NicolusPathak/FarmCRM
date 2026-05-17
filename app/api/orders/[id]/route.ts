// app/api/orders/[id]/route.ts — PATCH: edit (24h window) or void (any time).
// Staff and admin both allowed; every change is recorded in audit_log.
import { NextRequest, NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAuditOrFail } from '@/lib/audit';
import { safeError, clientError } from '@/lib/api-error';
import type { OrderLogEntry, PaymentMethod } from '@/types';
import { isPaymentMethod } from '@/types';

const MAX_LINE_QTY = 1000;
const MAX_NOTE_LEN = 500;

function validatePatchItems(items: unknown): asserts items is { item_name: string; quantity: number; unit_price: number }[] {
  if (!Array.isArray(items) || items.length === 0) clientError('At least one item is required.');
  for (const [idx, raw] of items.entries()) {
    const i = raw as { item_name?: unknown; quantity?: unknown; unit_price?: unknown };
    const name = typeof i?.item_name === 'string' ? i.item_name.trim() : '';
    const qty  = Number(i?.quantity);
    const px   = Number(i?.unit_price);
    if (!name)                  clientError(`Item ${idx + 1} needs a name.`);
    if (!Number.isFinite(qty))  clientError(`Item ${idx + 1} has an invalid quantity.`);
    if (qty <= 0)               clientError(`Item ${idx + 1} quantity must be greater than 0.`);
    if (qty > MAX_LINE_QTY)     clientError(`Item ${idx + 1} quantity is unrealistically large (max ${MAX_LINE_QTY}).`);
    if (!Number.isFinite(px))   clientError(`Item ${idx + 1} has an invalid price.`);
    if (px < 0)                 clientError(`Item ${idx + 1} price cannot be negative.`);
  }
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

async function adjustPoints(sb: any, customerId: string, delta: number): Promise<string | null> {
  if (delta === 0) return null;
  const { error } = await sb.rpc('increment_points', {
    customer_id_input: customerId,
    points_to_add:     delta,
  });
  return error ? error.message : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession();
  if (auth.error) return auth.error;
  const actor = auth.user;

  try {
  const sb = createSupabaseAdminClient();
  const { id } = await params;
  const body   = await req.json();

  const { data: existing, error: fetchErr } = await sb
    .from('orders')
    .select('*, customer:customers(id, full_name)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !existing) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  if ((existing as any).status === 'void') {
    return NextResponse.json({ error: 'This order has already been voided' }, { status: 409 });
  }

  // ── VOID action ───────────────────────────────────────────────
  if (body.action === 'void') {
    const pts             = (existing as any).points_earned as number;
    const pointsRedeemed  = ((existing as any).points_redeemed ?? 0) as number;
    // Net change on void:
    //   refund the redeemed points (+pointsRedeemed)
    //   reverse the earned points (-pts)
    const netPointsChange = pointsRedeemed - pts;

    const summaryParts: string[] = [];
    if (pts > 0)            summaryParts.push(`${pts} pts reversed`);
    if (pointsRedeemed > 0) summaryParts.push(`${pointsRedeemed} pts refunded`);
    const ptsSummary = summaryParts.length > 0 ? ` ${summaryParts.join(', ')} on customer balance.` : '';

    const entry: OrderLogEntry = {
      timestamp: new Date().toISOString(),
      type:      'voided',
      summary:   `Order voided by ${actor.name}.${ptsSummary}`,
    };
    const newLog = [...(((existing as any).change_log as OrderLogEntry[]) ?? []), entry];

    // Snapshot prior state for rollback if audit fails.
    const priorStatus    = (existing as any).status as string;
    const priorChangeLog = (existing as any).change_log;

    // Compare-and-swap on status='active' so two concurrent void requests
    // can't both proceed to reverse the same points twice. Whichever request
    // flips the status first "wins"; the loser gets 0 rows back and 409s.
    const { data: claimed, error: voidErr } = await sb.from('orders').update({
      status:     'void',
      change_log: newLog,
    }).eq('id', id).eq('status', 'active').select('id');
    if (voidErr) {
      console.error('[api:PATCH order void]', voidErr);
      return NextResponse.json({ error: 'Could not void order.' }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      // Another request voided this order between our fetch and our update.
      return NextResponse.json({ error: 'This order has already been voided' }, { status: 409 });
    }

    // Audit first (so we can still roll back the status flip if it fails).
    try {
      await logAuditOrFail({
        actor,
        action: 'voided',
        entity_type: 'order',
        entity_id: id,
        entity_label: `${(existing as any).order_number} — ${(existing as any).customer?.full_name ?? ''}`.trim(),
        changes: {
          total: (existing as any).total,
          points_reversed: pts,
          points_refunded: pointsRedeemed,
        },
      });
    } catch (auditErr) {
      console.error('[api:PATCH order void] audit failed — un-voiding', auditErr);
      await sb.from('orders').update({ status: priorStatus, change_log: priorChangeLog }).eq('id', id);
      return NextResponse.json({ error: 'Could not record void. No change made.' }, { status: 500 });
    }

    // Apply the net points change last — single RPC call covers both the
    // earned-reversal and the redemption-refund.
    if (netPointsChange !== 0) {
      const ptsErr = await adjustPoints(sb, (existing as any).customer_id, netPointsChange);
      if (ptsErr) {
        console.error('[api:PATCH order void] points adjust', ptsErr);
        return NextResponse.json({ error: 'Order voided but points could not be adjusted. Contact support.' }, { status: 500 });
      }
    }

    const { data: updated } = await sb
      .from('orders')
      .select('*, order_items(*), customer:customers(*)')
      .eq('id', id)
      .single();
    return NextResponse.json(updated);
  }

  // ── EDIT action ───────────────────────────────────────────────
  // Staff are bound by a 24-hour edit window (prevents historical-mess /
  // late-fraud). Admin and owner can fix older orders without restriction.
  const isManager = actor.role === 'admin' || actor.role === 'owner';
  if (!isManager) {
    const ageMs = Date.now() - new Date((existing as any).created_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Edit window has expired — only admin or owner can edit orders older than 24 hours.' },
        { status: 403 }
      );
    }
  }

  const { items, notes, customer_id } = body;
  validatePatchItems(items);
  const trimmedNotes = (notes ?? '').trim();
  if (trimmedNotes.length > MAX_NOTE_LEN) clientError(`Notes are too long (max ${MAX_NOTE_LEN}).`);

  // payment_method handling (admin-only). If the field is in the body and
  // the actor is not an admin, refuse the entire request — don't silently
  // ignore the field (silent drops are how data drifts).
  const oldPayment = ((existing as any).payment_method ?? 'cash') as PaymentMethod;
  let newPayment: PaymentMethod = oldPayment;
  if (Object.prototype.hasOwnProperty.call(body, 'payment_method')) {
    if (actor.role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can change payment method' }, { status: 403 });
    }
    if (!isPaymentMethod(body.payment_method)) clientError('Invalid payment method.');
    newPayment = body.payment_method;
  }
  const paymentChanged = newPayment !== oldPayment;

  const newCustomerId   = customer_id ?? (existing as any).customer_id;
  const oldCustomerId   = (existing as any).customer_id as string;
  const customerChanged = newCustomerId !== oldCustomerId;

  let newCustomerName = '';
  if (customerChanged) {
    const { data: newCust } = await sb
      .from('customers')
      .select('id, full_name, archived_at')
      .eq('id', newCustomerId)
      .maybeSingle();
    if (!newCust) return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
    if ((newCust as any).archived_at) {
      return NextResponse.json({ error: 'That customer has been deleted and cannot receive orders' }, { status: 400 });
    }
    newCustomerName = (newCust as any).full_name;
  }

  // Mirror the DB trigger's math exactly to avoid off-by-1 points on fractional
  // quantities. SQL does ROUND(qty * unit_price, 2) per line, then SUM, then FLOOR.
  // We compute each line in integer cents to dodge float drift, then sum, then floor.
  // (The line_total we send is informational — the BEFORE INSERT trigger on
  // order_items overwrites it; the values below are what the orders row stores.)
  const newItems = items.map((i) => {
    const qty = Number(i.quantity);
    const px  = Number(i.unit_price);
    const lineCents = Math.round(qty * px * 100); // matches SQL ROUND(..., 2)
    return {
      order_id:   id,
      item_name:  String(i.item_name ?? '').trim(),
      quantity:   qty,
      unit_price: px,
      line_total: lineCents / 100,
      _cents:     lineCents,
    };
  });
  const totalCents      = newItems.reduce((s: number, i: any) => s + i._cents, 0);
  const newSubtotal     = totalCents / 100;
  const newPointsEarned = Math.floor(totalCents / 100); // matches SQL FLOOR(subtotal)
  const oldPointsEarned = (existing as any).points_earned as number;

  const summaryParts: string[] = [];
  if (customerChanged) {
    const oldName = (existing as any).customer?.full_name ?? 'previous customer';
    summaryParts.push(`Reassigned from ${oldName} to ${newCustomerName}`);
  }
  const oldTotal = (existing as any).total as number;
  if (Math.abs(newSubtotal - oldTotal) > 0.001) {
    summaryParts.push(`Total: ${$(oldTotal)} → ${$(newSubtotal)}`);
  }
  if (newPointsEarned !== oldPointsEarned) {
    summaryParts.push(`Points: ${oldPointsEarned} → ${newPointsEarned} pts`);
  }
  if ((notes ?? '').trim() !== ((existing as any).notes ?? '').trim()) {
    summaryParts.push('Notes updated');
  }
  if (paymentChanged) {
    summaryParts.push(`Payment: ${oldPayment} → ${newPayment}`);
  }

  const logEntry: OrderLogEntry = {
    timestamp: new Date().toISOString(),
    type:      customerChanged ? 'reassigned' : 'modified',
    summary:   `${summaryParts.length > 0 ? summaryParts.join('. ') : 'Order updated'} (by ${actor.name})`,
  };
  const newLog = [...(((existing as any).change_log as OrderLogEntry[]) ?? []), logEntry];

  // ── SNAPSHOT for compensating rollback if audit fails ─────────
  // Capture every value we're about to mutate BEFORE any DB write.
  // Critical: stored as absolute values, not deltas — the rollback
  // SET-restores from these. Recomputing a delta in the rollback is
  // how points get double-counted.
  const { data: originalItemsRaw } = await sb
    .from('order_items')
    .select('item_name, quantity, unit_price, line_total')
    .eq('order_id', id);
  const originalItemsSnap = (originalItemsRaw ?? []).map((i: any) => ({
    item_name:  i.item_name,
    quantity:   Number(i.quantity),
    unit_price: Number(i.unit_price),
    line_total: Number(i.line_total),
  }));
  const orderSnap = {
    subtotal:       Number((existing as any).subtotal),
    total:          Number((existing as any).total),
    points_earned:  Number((existing as any).points_earned),
    notes:          (existing as any).notes ?? null,
    change_log:     (existing as any).change_log ?? [],
    customer_id:    oldCustomerId,
    payment_method: oldPayment,
  };
  // Snapshot points_balance for the affected customer(s).
  const { data: oldCustRow } = await sb.from('customers').select('points_balance').eq('id', oldCustomerId).maybeSingle();
  const oldCustPointsSnap = Number((oldCustRow as any)?.points_balance ?? 0);
  let newCustPointsSnap: number | null = null;
  if (customerChanged) {
    const { data: newCustRow } = await sb.from('customers').select('points_balance').eq('id', newCustomerId).maybeSingle();
    newCustPointsSnap = Number((newCustRow as any)?.points_balance ?? 0);
  }

  // Defensive re-check just before we start mutating. The earlier check at the
  // top of this handler reads `existing` from a fetch that happened many
  // statements ago; in between, another request could have voided this order.
  // Re-reading status now narrows the race window to ~milliseconds. The
  // remaining window (between this check and the items DELETE) is small
  // enough that the rollback path below would catch any audit-time failure.
  const { data: liveStatus } = await sb
    .from('orders')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!liveStatus || (liveStatus as any).status !== 'active') {
    return NextResponse.json(
      { error: 'This order is no longer active and cannot be edited.' },
      { status: 409 },
    );
  }

  const { error: delErr } = await sb.from('order_items').delete().eq('order_id', id);
  if (delErr) {
    console.error('[api:PATCH order edit] item delete', delErr);
    return NextResponse.json({ error: 'Could not update order items.' }, { status: 500 });
  }

  // Strip the `_cents` helper field before sending to Postgres — it's not a column.
  const itemsToInsert = newItems.map(({ _cents: _, ...rest }) => rest);
  const { error: insErr } = await sb.from('order_items').insert(itemsToInsert as any);
  if (insErr) {
    console.error('[api:PATCH order edit] item insert', insErr);
    if (insErr.code === '23514') return NextResponse.json({ error: 'One of the items has an invalid quantity or price.' }, { status: 400 });
    return NextResponse.json({ error: 'Could not save order items.' }, { status: 500 });
  }

  const orderUpdate: Record<string, any> = {
    subtotal:      newSubtotal,
    total:         newSubtotal,
    points_earned: newPointsEarned,
    notes:         trimmedNotes || null,
    change_log:    newLog,
  };
  if (customerChanged) orderUpdate.customer_id   = newCustomerId;
  if (paymentChanged)  orderUpdate.payment_method = newPayment;

  const { error: updErr } = await sb.from('orders').update(orderUpdate).eq('id', id);
  if (updErr) {
    console.error('[api:PATCH order edit] update', updErr);
    return NextResponse.json({ error: 'Could not save order.' }, { status: 500 });
  }

  if (customerChanged) {
    if (oldPointsEarned > 0) {
      const e1 = await adjustPoints(sb, oldCustomerId, -oldPointsEarned);
      if (e1) { console.error('[api:PATCH order edit] old points', e1); return NextResponse.json({ error: 'Order saved but points could not be reversed. Contact support.' }, { status: 500 }); }
    }
    if (newPointsEarned > 0) {
      const e2 = await adjustPoints(sb, newCustomerId, newPointsEarned);
      if (e2) { console.error('[api:PATCH order edit] new points', e2); return NextResponse.json({ error: 'Order saved but points could not be credited. Contact support.' }, { status: 500 }); }
    }
  } else {
    const delta = newPointsEarned - oldPointsEarned;
    const e = await adjustPoints(sb, oldCustomerId, delta);
    if (e) { console.error('[api:PATCH order edit] points delta', e); return NextResponse.json({ error: 'Order saved but points could not be updated. Contact support.' }, { status: 500 }); }
  }

  try {
    await logAuditOrFail({
      actor,
      action: customerChanged ? 'order_reassigned' : 'updated',
      entity_type: 'order',
      entity_id: id,
      entity_label: `${(existing as any).order_number}`,
      changes: {
        ...(customerChanged ? { customer: { from: (existing as any).customer?.full_name ?? null, to: newCustomerName } } : {}),
        ...(Math.abs(newSubtotal - oldTotal) > 0.001 ? { total: { from: oldTotal, to: newSubtotal } } : {}),
        ...(newPointsEarned !== oldPointsEarned ? { points_earned: { from: oldPointsEarned, to: newPointsEarned } } : {}),
        ...((notes ?? '').trim() !== ((existing as any).notes ?? '').trim() ? { notes: { from: (existing as any).notes ?? '', to: (notes ?? '').trim() } } : {}),
        ...(paymentChanged ? { payment_method: { from: oldPayment, to: newPayment } } : {}),
      },
    });
  } catch (auditErr) {
    console.error('[api:PATCH order edit] audit failed — reverting in reverse order', auditErr);

    // Reverse in the OPPOSITE order of mutation:
    //   1. Restore customer point balances to absolute snapshot values
    //      (NOT recomputed via delta — recomputation double-counts).
    //   2. Restore the orders row to its snapshot.
    //   3. Delete current order_items + reinsert the snapshot lines.
    await sb.from('customers').update({ points_balance: oldCustPointsSnap } as any).eq('id', oldCustomerId);
    if (customerChanged && newCustPointsSnap !== null) {
      await sb.from('customers').update({ points_balance: newCustPointsSnap } as any).eq('id', newCustomerId);
    }
    await sb.from('orders').update(orderSnap as any).eq('id', id);
    await sb.from('order_items').delete().eq('order_id', id);
    if (originalItemsSnap.length > 0) {
      await sb.from('order_items').insert(
        originalItemsSnap.map(i => ({ order_id: id, ...i })) as any,
      );
    }
    return NextResponse.json({ error: 'Could not record change. No change made.' }, { status: 500 });
  }

  const { data: updated, error: finalErr } = await sb
    .from('orders')
    .select('*, order_items(*), customer:customers(*)')
    .eq('id', id)
    .single();
  if (finalErr) {
    console.error('[api:PATCH order] reload', finalErr);
    return NextResponse.json({ error: 'Order saved, but could not reload.' }, { status: 500 });
  }

  return NextResponse.json(updated);
  } catch (err) {
    return safeError(err, 'Could not update order.', 'PATCH /api/orders/[id]');
  }
}
