// app/api/import/route.ts — Admin-only bulk customer import
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const sb = createSupabaseAdminClient();
  const { customers } = await req.json();
  if (!Array.isArray(customers) || customers.length === 0) {
    return NextResponse.json({ error: 'No customers provided' }, { status: 400 });
  }

  const { data: existing } = await sb
    .from('customers')
    .select('phone_number')
    .is('archived_at', null);
  const existingPhones = new Set(
    (existing ?? []).map((c: any) => c.phone_number).filter(Boolean)
  );

  const toInsert = customers.filter((c: any) =>
    !c.phone_number || !existingPhones.has(c.phone_number)
  );
  const skipped = customers.length - toInsert.length;

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped, errors: [] });
  }

  const count = toInsert.length;
  const { data: seqData, error: seqErr } = await sb.rpc(
    'reserve_customer_numbers' as any,
    { n: count }
  );

  let customerNumbers: string[] = [];

  if (seqErr || !seqData) {
    for (let i = 0; i < count; i++) {
      const { data } = await sb.rpc('get_next_customer_number');
      customerNumbers.push(data as string);
    }
  } else {
    customerNumbers = (seqData as string[]);
  }

  const BATCH   = 100;
  let inserted  = 0;
  const errors: string[] = [];

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch   = toInsert.slice(i, i + BATCH);
    const records = batch.map((c: any, j: number) => ({
      customer_number: customerNumbers[i + j],
      full_name:       c.full_name,
      phone_number:    c.phone_number   || null,
      street:          c.street         || null,
      city:            c.city           || null,
      zip_code:        c.zip_code       || null,
      points_balance:  0,
    }));

    const { data, error } = await sb
      .from('customers')
      .insert(records as any)
      .select('id');

    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    } else {
      inserted += data?.length ?? 0;
    }
  }

  if (inserted > 0) {
    await logAudit({
      actor: auth.user,
      action: 'created',
      entity_type: 'customer',
      entity_label: `Bulk import (${inserted} customers)`,
      changes: { inserted, skipped, errors_count: errors.length },
    });
  }

  return NextResponse.json({ inserted, skipped, errors });
}
