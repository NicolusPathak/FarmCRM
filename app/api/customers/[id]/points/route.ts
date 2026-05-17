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
import { logAudit } from '@/lib/audit';

const MAX_REASON = 280;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Accept either `delta` (signed integer) or `reason`. The UI sends both;
  // missing reason gets a default so we still have audit context.
  const delta  = Number(body.delta);
  const reason = String(body.reason ?? '').trim().slice(0, MAX_REASON) || 'Manual adjustment';

  if (!Number.isInteger(delta) || delta === 0) {
    return NextResponse.json({ error: 'Adjustment must be a non-zero whole number.' }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data: existing } = await sb
    .from('customers')
    .select('id, full_name, points_balance')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const current = Number((existing as any).points_balance ?? 0);
  const next    = current + delta;
  if (next < 0) {
    return NextResponse.json(
      { error: `Customer has only ${current} points. Cannot deduct ${Math.abs(delta)}.` },
      { status: 400 },
    );
  }

  const { error: updErr } = await sb
    .from('customers')
    .update({ points_balance: next } as any)
    .eq('id', id);
  if (updErr) {
    if ((updErr as any).code === '23514') {
      return NextResponse.json({ error: 'Balance would go negative.' }, { status: 400 });
    }
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAudit({
    actor: auth.user,
    action: 'points_adjusted',
    entity_type: 'customer',
    entity_id: id,
    entity_label: (existing as any).full_name,
    changes: {
      delta,
      reason,
      balance: { from: current, to: next },
    },
  });

  return NextResponse.json({ id, points_balance: next });
}
