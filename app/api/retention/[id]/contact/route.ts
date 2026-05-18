// app/api/retention/[id]/contact/route.ts — Mark a customer as contacted.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';
import { safeError } from '@/lib/api-error';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const sb = createSupabaseAdminClient();

  const { data: existing } = await sb
    .from('customers')
    .select('id, full_name, last_contacted_at')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const now = new Date().toISOString();
  const { error } = await sb
    .from('customers')
    .update({ last_contacted_at: now, contacted_by_id: auth.user.id } as any)
    .eq('id', id);
  if (error) return safeError(error, 'Could not update customer.', 'retention/contact');

  await logAudit({
    actor: auth.user,
    action: 'updated',
    entity_type: 'customer',
    entity_id: id,
    entity_label: (existing as any).full_name,
    changes: { last_contacted_at: { from: (existing as any).last_contacted_at, to: now } },
  });

  return NextResponse.json({ id, last_contacted_at: now });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Undo: clear the contacted timestamp so the customer re-appears in the list.
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const sb = createSupabaseAdminClient();

  const { data: existing } = await sb
    .from('customers')
    .select('id, full_name, last_contacted_at')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const { error } = await sb
    .from('customers')
    .update({ last_contacted_at: null, contacted_by_id: null } as any)
    .eq('id', id);
  if (error) return safeError(error, 'Could not update customer.', 'retention/contact');

  await logAudit({
    actor: auth.user,
    action: 'updated',
    entity_type: 'customer',
    entity_id: id,
    entity_label: (existing as any).full_name,
    changes: { last_contacted_at: { from: (existing as any).last_contacted_at, to: null } },
  });

  return NextResponse.json({ id, last_contacted_at: null });
}
