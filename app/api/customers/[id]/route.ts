// app/api/customers/[id]/route.ts — GET / PATCH / DELETE a single customer.
// Staff CAN update customer info. Only ADMIN can delete (archive).
import { NextRequest, NextResponse } from 'next/server';
import { apiSession, apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { getCustomer } from '@/lib/db';
import { logAuditOrFail, diffFields } from '@/lib/audit';
import { safeError, clientError } from '@/lib/api-error';
import { normalizePhone } from '@/lib/utils';
import type { Customer } from '@/types';

const EDITABLE_KEYS: (keyof Customer)[] = ['full_name', 'phone_number', 'street', 'city', 'zip_code'];
const MAX_NAME_LEN = 120;
const MAX_ADDR_LEN = 500;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const customer = await getCustomer(id);
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(customer);
  } catch (err) {
    return safeError(err, 'Could not load customer.', 'GET /api/customers/[id]');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  try {
    const sb = createSupabaseAdminClient();
    const { id } = await params;

    const { data: existing } = await sb.from('customers').select('id, full_name, archived_at').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const archivedAt = new Date().toISOString();
    const { error } = await sb
      .from('customers')
      .update({ archived_at: archivedAt } as any)
      .eq('id', id)
      .is('archived_at', null);
    if (error) {
      console.error('[api:DELETE customer]', error);
      return NextResponse.json({ error: 'Could not delete customer.' }, { status: 500 });
    }

    // Audit must succeed or we un-archive. Approximate transaction.
    try {
      await logAuditOrFail({
        actor: auth.user,
        action: 'archived',
        entity_type: 'customer',
        entity_id: id,
        entity_label: (existing as any).full_name,
      });
    } catch (auditErr) {
      console.error('[api:DELETE customer] audit failed — un-archiving', auditErr);
      await sb.from('customers').update({ archived_at: null } as any).eq('id', id);
      return NextResponse.json({ error: 'Could not record deletion. No change made.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return safeError(err, 'Could not delete customer.', 'DELETE /api/customers/[id]');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession();
  if (auth.error) return auth.error;

  try {
    const sb = createSupabaseAdminClient();
    const { id } = await params;
    const body   = await req.json();

    // Staff-forbidden field guard.
    if ('points_balance' in body || 'customer_number' in body) {
      return NextResponse.json({ error: 'That field cannot be edited here' }, { status: 403 });
    }

    // Build patch with optional-field coalescing.
    const patch: Partial<Customer> = {};
    if ('full_name'    in body) {
      const v = (body.full_name ?? '').trim();
      if (!v) clientError('Full name is required.');
      if (v.length > MAX_NAME_LEN) clientError(`Name is too long (max ${MAX_NAME_LEN}).`);
      patch.full_name = v;
    }
    if ('phone_number' in body) {
      // Normalize to canonical "(NNN) NNN-NNNN" so format differences can't
      // bypass the active-phone uniqueness index. See createCustomer for the
      // same rule on insert.
      const raw = (body.phone_number ?? '').trim();
      patch.phone_number = raw ? normalizePhone(raw) : null;
    }
    if ('street'       in body) {
      const v = (body.street ?? '').trim() || null;
      if (v && v.length > MAX_ADDR_LEN) clientError(`Street is too long (max ${MAX_ADDR_LEN}).`);
      patch.street = v;
    }
    if ('city'         in body) {
      const v = (body.city ?? '').trim() || null;
      if (v && v.length > MAX_ADDR_LEN) clientError(`City is too long (max ${MAX_ADDR_LEN}).`);
      patch.city = v;
    }
    if ('zip_code'     in body) {
      const v = (body.zip_code ?? '').trim() || null;
      if (v && v.length > 20) clientError('ZIP is too long.');
      patch.zip_code = v;
    }

    const { data: before } = await sb.from('customers').select('*').eq('id', id).maybeSingle();
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if ((before as any).archived_at) return NextResponse.json({ error: 'Customer is archived.' }, { status: 400 });

    // Phone-uniqueness pre-check if phone is changing.
    if (patch.phone_number && patch.phone_number !== (before as any).phone_number) {
      const { data: clash } = await sb
        .from('customers')
        .select('customer_number, full_name, id')
        .eq('phone_number', patch.phone_number)
        .is('archived_at', null)
        .neq('id', id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json({
          error: `That phone is already in use by ${(clash as any).customer_number} (${(clash as any).full_name}).`,
          customer_number: (clash as any).customer_number,
        }, { status: 409 });
      }
    }

    // Guard against a concurrent DELETE: only update rows still active.
    // If admin archives the customer between our `before` fetch and this
    // write, the .is('archived_at', null) filter matches zero rows and we
    // return a clear 409 instead of silently writing to an archived row.
    const { data: after, error } = await sb
      .from('customers')
      .update(patch as any)
      .eq('id', id)
      .is('archived_at', null)
      .select()
      .maybeSingle();
    if (error) {
      console.error('[api:PATCH customer]', error);
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That phone is already in use.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Could not update customer.' }, { status: 500 });
    }
    if (!after) {
      // Either the customer disappeared (race with delete) or never existed.
      return NextResponse.json(
        { error: 'This customer was deleted while you were editing. Reload to see current data.' },
        { status: 409 },
      );
    }

    const changes = diffFields(before as Customer, patch, EDITABLE_KEYS);
    if (Object.keys(changes).length > 0) {
      try {
        await logAuditOrFail({
          actor: auth.user,
          action: 'updated',
          entity_type: 'customer',
          entity_id: id,
          entity_label: (after as Customer).full_name,
          changes,
        });
      } catch (auditErr) {
        console.error('[api:PATCH customer] audit failed — reverting', auditErr);
        // Compensating rollback: restore every editable field to the pre-edit snapshot.
        const restore: Record<string, unknown> = {};
        for (const k of EDITABLE_KEYS) restore[String(k)] = (before as any)[k];
        await sb.from('customers').update(restore as any).eq('id', id);
        return NextResponse.json({ error: 'Could not record change. No change made.' }, { status: 500 });
      }
    }

    return NextResponse.json(after);
  } catch (err) {
    return safeError(err, 'Could not update customer.', 'PATCH /api/customers/[id]');
  }
}
