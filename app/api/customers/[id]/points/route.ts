// app/api/customers/[id]/points/route.ts — Admin / owner only: manually
// adjust a customer's points balance. Used for in-store redemptions ("I'm
// giving you $5 off for 100 points"), promotional credits, or correcting
// bookkeeping mistakes.
//
// Every adjustment is loud in the audit log so you can reconstruct what
// happened later. Negative balances are rejected — the DB also has a CHECK
// constraint as belt-and-suspenders.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAuditOrFail } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

const MAX_REASON = 280;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const delta  = Number(body.delta);
    const reason = String(body.reason ?? '').trim().slice(0, MAX_REASON) || 'Manual adjustment';

    if (!Number.isInteger(delta) || delta === 0) {
      return NextResponse.json({ error: 'Adjustment must be a non-zero whole number.' }, { status: 400 });
    }

    const sb = createSupabaseAdminClient();

    // Existence check is informational (404 + capture name for audit).
    // The actual increment is atomic via the RPC; concurrent adjustments
    // can't race because each call is a single UPDATE that the DB CHECK
    // constraint either accepts or rejects atomically.
    const { data: existing } = await sb
      .from('customers')
      .select('id, full_name, points_balance')
      .eq('id', id)
      .is('archived_at', null)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const before = Number((existing as any).points_balance ?? 0);

    // Atomic check-and-decrement via the RPC. CHECK (points_balance >= 0)
    // catches concurrent deductions that would push the balance negative,
    // returning Postgres code 23514. No read-modify-write race.
    const { error: rpcErr } = await sb.rpc('increment_points' as any, {
      customer_id_input: id,
      points_to_add:     delta,
    });
    if (rpcErr) {
      if ((rpcErr as any).code === '23514') {
        return NextResponse.json(
          { error: `Customer does not have enough points for that deduction.` },
          { status: 409 },
        );
      }
      return safeError(rpcErr, 'Could not update points.', 'POST /api/customers/[id]/points');
    }

    // Read back the actual new balance (since `before` might be stale if
    // a concurrent adjustment ran between our SELECT and the RPC).
    const { data: after } = await sb
      .from('customers')
      .select('points_balance')
      .eq('id', id)
      .maybeSingle();
    const newBalance = Number((after as any)?.points_balance ?? before + delta);

    // Audit MUST succeed for a money-adjacent operation. On failure we
    // reverse the increment so the system stays consistent.
    try {
      await logAuditOrFail({
        actor: auth.user,
        action: 'points_adjusted',
        entity_type: 'customer',
        entity_id: id,
        entity_label: (existing as any).full_name,
        changes: {
          delta,
          reason,
          balance: { from: before, to: newBalance },
        },
      });
    } catch (auditErr) {
      console.error('[api:POST customer points] audit failed — attempting reverse', auditErr);
      const { error: reverseErr } = await sb.rpc('increment_points' as any, {
        customer_id_input: id,
        points_to_add:     -delta,
      });
      if (reverseErr) {
        // Worst case: balance moved, audit failed, AND the reverse also
        // failed. Customer is in an inconsistent state with no audit row.
        // Log loudly so an operator can manually reconcile from server logs.
        console.error(
          '[api:POST customer points] CRITICAL: reverse-increment also failed — manual reconciliation required',
          { customer_id: id, delta, reverseErr },
        );
        return NextResponse.json(
          { error: 'Adjustment partially applied. Contact support immediately.' },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: 'Could not record adjustment. No change made.' }, { status: 500 });
    }

    return NextResponse.json({ id, points_balance: newBalance });
  } catch (err) {
    return safeError(err, 'Could not update points.', 'POST /api/customers/[id]/points');
  }
}
