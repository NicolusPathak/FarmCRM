// app/api/staff/route.ts — Admin-only: list and create staff PINs.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { hashPin } from '@/lib/session';
import { logAudit } from '@/lib/audit';

export async function GET() {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from('staff_users')
    .select('id, name, role, active, created_at, created_by, archived_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const body = await req.json();
  const name = String(body.name ?? '').trim();
  const role = body.role === 'admin' ? 'admin' : 'staff';
  const pin  = String(body.pin ?? '').trim();

  // Only the owner can mint a new admin PIN. Admins can only create staff PINs.
  if (role === 'admin' && auth.user.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the owner can create an admin PIN.' },
      { status: 403 },
    );
  }

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be exactly 4 digits.' }, { status: 400 });
  }

  const pin_hash = await hashPin(pin);
  const sb = createSupabaseAdminClient();

  // Check for collision
  const { data: collision } = await sb
    .from('staff_users')
    .select('id')
    .eq('pin_hash', pin_hash)
    .is('archived_at', null)
    .maybeSingle();
  if (collision) {
    return NextResponse.json({ error: 'That PIN is already in use. Try a different one.' }, { status: 409 });
  }

  // created_by FK → staff_users(id). Owner IDs live in owner_credentials,
  // so set it to null when the owner is creating an admin PIN.
  const createdBy = auth.user.role === 'owner' ? null : auth.user.id;

  const { data, error } = await sb
    .from('staff_users')
    .insert({ name, pin_hash, role, active: true, created_by: createdBy } as any)
    .select('id, name, role, active, created_at, created_by, archived_at')
    .single();
  if (error) {
    // Race-condition catch: another request claimed this PIN between our
    // pre-check and our insert. Return the same friendly 409 either way.
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: 'That PIN is already in use. Try a different one.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    actor: auth.user,
    action: 'pin_created',
    entity_type: 'staff',
    entity_id: (data as any).id,
    entity_label: `${name} (${role})`,
    changes: { name, role },
  });

  return NextResponse.json(data, { status: 201 });
}
