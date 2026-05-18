// app/api/staff/[id]/pin/route.ts — Reset someone's PIN.
//   - Owner can reset any PIN (staff or admin).
//   - Admin can reset only STAFF PINs (admin↔admin resets are owner-only).
//   - Staff has no access.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { hashPin } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pin = String(body.pin ?? '').trim();

  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be exactly 4 digits.' }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  const { data: target } = await sb
    .from('staff_users')
    .select('id, name, role, pin_hash, session_version')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Owner-only gate for admin rows.
  if ((target as any).role === 'admin' && auth.user.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the owner can reset an admin PIN.' },
      { status: 403 },
    );
  }

  const pin_hash = await hashPin(pin);

  // Reject a "reset" to the row's own current PIN — silently succeeding
  // would mislead the user (toast says "reset" but nothing changed) and
  // pollute the audit log with no-op events. The implicit promise of a
  // reset is "the old PIN no longer works", so reusing the same value
  // defeats the purpose.
  if ((target as any).pin_hash === pin_hash) {
    return NextResponse.json(
      { error: 'New PIN must be different from the current one.' },
      { status: 400 },
    );
  }

  // Block collision with any OTHER active row.
  const { data: collision } = await sb
    .from('staff_users')
    .select('id')
    .eq('pin_hash', pin_hash)
    .is('archived_at', null)
    .neq('id', id)
    .maybeSingle();
  if (collision) {
    return NextResponse.json({ error: 'That PIN is already in use. Try a different one.' }, { status: 409 });
  }

  // Bumping session_version invalidates any outstanding cookie for this
  // user — without this, a PIN reset wouldn't kick them out of an
  // existing browser session.
  const nextVersion = (((target as any).session_version ?? 0) as number) + 1;
  const { error } = await sb
    .from('staff_users')
    .update({ pin_hash, session_version: nextVersion } as any)
    .eq('id', id);
  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: 'That PIN is already in use. Try a different one.' }, { status: 409 });
    }
    return safeError(error, 'Could not reset PIN.', 'PUT /api/staff/[id]/pin');
  }

  await logAudit({
    actor: auth.user,
    action: 'pin_reset',
    entity_type: 'staff',
    entity_id: id,
    entity_label: `${(target as any).name} (${(target as any).role})`,
  });

  return NextResponse.json({ success: true });
}
