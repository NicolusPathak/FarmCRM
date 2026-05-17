// app/api/staff/[id]/route.ts — Rename or revoke a staff/admin row.
//   - Owner can rename or revoke anyone.
//   - Admin can rename or revoke STAFF only (admin↔admin actions are owner-only).
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';

const MAX_NAME = 80;

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot revoke your own PIN.' }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data: existing } = await sb
    .from('staff_users')
    .select('id, name, role, session_version')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only the owner can revoke another admin's PIN.
  if ((existing as any).role === 'admin' && auth.user.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the owner can revoke an admin PIN.' },
      { status: 403 },
    );
  }

  // Bump session_version so any outstanding browser cookie for this user
  // stops working immediately, in addition to archiving the row. The
  // archive alone would suffice for getSession() to reject the user, but
  // bumping the version too is belt-and-suspenders.
  const nextVersion = (((existing as any).session_version ?? 0) as number) + 1;
  const { error } = await sb
    .from('staff_users')
    .update({
      active: false,
      archived_at: new Date().toISOString(),
      session_version: nextVersion,
    } as any)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    actor: auth.user,
    action: 'pin_revoked',
    entity_type: 'staff',
    entity_id: id,
    entity_label: `${(existing as any).name} (${(existing as any).role})`,
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();

  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Name is too long (max ${MAX_NAME} characters).` }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data: existing } = await sb
    .from('staff_users')
    .select('id, name, role')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only the owner can rename another admin.
  if ((existing as any).role === 'admin' && auth.user.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the owner can rename an admin.' },
      { status: 403 },
    );
  }

  const oldName = (existing as any).name as string;
  if (oldName === name) {
    // No-op rename — just return the row so the client can refresh.
    return NextResponse.json({ id, name });
  }

  const { error } = await sb
    .from('staff_users')
    .update({ name } as any)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    actor: auth.user,
    action: 'updated',
    entity_type: 'staff',
    entity_id: id,
    entity_label: `${name} (${(existing as any).role})`,
    changes: { name: { from: oldName, to: name } },
  });

  return NextResponse.json({ id, name });
}
