// app/api/import/route.ts — Admin-only bulk customer import
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAudit } from '@/lib/audit';

// Cap the body at 5MB and the array at 10k rows. Defends against accidental
// or malicious large payloads — Next.js Route Handlers have no automatic
// body size limit, so without these checks an attacker could OOM the
// function with an arbitrarily large JSON. 5MB / 10k handles every
// realistic shop list with significant headroom.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ROWS       = 10_000;
const MAX_FIELD_LEN  = 500;

export async function POST(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  // Reject oversized payloads BEFORE parsing — req.json() would otherwise
  // happily load the whole thing into memory first.
  const len = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Import payload too large (${(len / 1024 / 1024).toFixed(1)}MB > 5MB limit).` },
      { status: 413 },
    );
  }

  const sb = createSupabaseAdminClient();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const { customers } = body as { customers?: unknown };
  if (!Array.isArray(customers) || customers.length === 0) {
    return NextResponse.json({ error: 'No customers provided' }, { status: 400 });
  }
  if (customers.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${customers.length} > ${MAX_ROWS} max). Split into smaller imports.` },
      { status: 413 },
    );
  }

  // Defensive per-row field-length cap so a single oversized name/address
  // can't blow up the DB row.
  for (const [i, c] of (customers as any[]).entries()) {
    if (!c || typeof c !== 'object') {
      return NextResponse.json({ error: `Row ${i + 1} is malformed.` }, { status: 400 });
    }
    for (const k of ['full_name', 'phone_number', 'street', 'city', 'zip_code']) {
      const v = (c as any)[k];
      if (v != null && typeof v === 'string' && v.length > MAX_FIELD_LEN) {
        return NextResponse.json(
          { error: `Row ${i + 1} field "${k}" exceeds ${MAX_FIELD_LEN} chars.` },
          { status: 400 },
        );
      }
    }
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
