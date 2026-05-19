// lib/db.ts — All server-side data access functions.
// Uses the Supabase service-role client (bypasses RLS).
// Functions that mutate accept an `actor: SessionUser` so we can write to audit_log.

import { createSupabaseAdminClient } from './supabase-server';
import type { Customer, Order, NewCustomerForm, NewOrderForm, SessionUser, PaymentMethod } from '@/types';
import { isPaymentMethod } from '@/types';
import { digitSearchPattern, normalizePhone, shopRanges } from './utils';
import { logAuditOrFail } from './audit';
import { clientError } from './api-error';

// Caps for input validation — kept in one place so they can't drift between
// the order-create and order-edit paths.
const MAX_LINE_QTY     = 1000;
const MAX_NAME_LEN     = 120;
const MAX_NOTE_LEN     = 500;
const MAX_ADDR_LEN     = 500;

function validateOrderItems(items: unknown): asserts items is { item_name: string; quantity: number; unit_price: number }[] {
  if (!Array.isArray(items) || items.length === 0) clientError('At least one item is required.');
  for (const [idx, raw] of items.entries()) {
    if (!raw || typeof raw !== 'object') clientError(`Item ${idx + 1} is malformed.`);
    const i = raw as { item_name?: unknown; quantity?: unknown; unit_price?: unknown };
    const name = typeof i.item_name === 'string' ? i.item_name.trim() : '';
    const qty  = Number(i.quantity);
    const px   = Number(i.unit_price);
    if (!name)                       clientError(`Item ${idx + 1} needs a name.`);
    if (!Number.isFinite(qty))       clientError(`Item ${idx + 1} has an invalid quantity.`);
    if (qty <= 0)                    clientError(`Item ${idx + 1} quantity must be greater than 0.`);
    if (qty > MAX_LINE_QTY)          clientError(`Item ${idx + 1} quantity is unrealistically large (max ${MAX_LINE_QTY}).`);
    if (!Number.isFinite(px))        clientError(`Item ${idx + 1} has an invalid price.`);
    if (px < 0)                      clientError(`Item ${idx + 1} price cannot be negative.`);
  }
}

// ─────────────────────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────────────────────

export async function searchCustomers(query: string): Promise<Customer[]> {
  const sb = createSupabaseAdminClient();
  const q  = query.trim();

  if (!q) {
    const { data } = await sb
      .from('customers')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    return (data as Customer[]) ?? [];
  }

  // PostgREST's .or() splits the joined string on commas. If the raw query
  // contains a comma (or other reserved chars like (), :, .), the value
  // must be wrapped in double quotes — with any internal " escaped by
  // doubling. Without this, searching `Jane, Smith` would silently mis-parse
  // into two filters and return wrong results.
  const quote = (pattern: string) => `"${pattern.replace(/"/g, '""')}"`;
  const pat = quote(`%${q}%`);

  const orParts = [
    `full_name.ilike.${pat}`,
    `phone_number.ilike.${pat}`,
    `customer_number.ilike.${pat}`,
    `city.ilike.${pat}`,
    `street.ilike.${pat}`,
    `zip_code.ilike.${pat}`,
  ];

  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && digits === q) {
    const pattern = digitSearchPattern(digits);
    // digitSearchPattern only emits digits + %, but quoting it is still safe.
    if (pattern) orParts.push(`phone_number.ilike.${quote(pattern)}`);
  }

  const { data } = await sb
    .from('customers')
    .select('*')
    .is('archived_at', null)
    .or(orParts.join(','))
    .order('full_name')
    .limit(30);

  return (data as Customer[]) ?? [];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const sb = createSupabaseAdminClient();
  const { data } = await sb.from('customers').select('*').eq('id', id).single();
  const customer = (data as Customer) ?? null;
  if (customer?.archived_at) return null;
  return customer;
}

export async function getCustomerOrders(customerId: string): Promise<Order[]> {
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from('orders')
    .select('*, order_items(*)')
    .eq('customer_id', customerId)
    .order('order_date', { ascending: false });
  return (data as Order[]) ?? [];
}

export async function createCustomer(form: NewCustomerForm, actor: SessionUser): Promise<Customer> {
  const sb = createSupabaseAdminClient();

  const full_name = (form.full_name ?? '').trim();
  if (!full_name) clientError('Full name is required.');
  if (full_name.length > MAX_NAME_LEN) clientError(`Name is too long (max ${MAX_NAME_LEN} characters).`);

  // Coalesce optional fields — clients may omit them entirely.
  // Phones are normalized to a canonical "(NNN) NNN-NNNN" so that
  // "(817) 555-1234", "817-555-1234", and "8175551234" all collapse to one
  // value — preventing duplicate customers from format-only differences.
  const phoneRaw     = (form.phone_number ?? '').trim();
  const phone_number = phoneRaw ? normalizePhone(phoneRaw) : null;
  const street       = (form.street       ?? '').trim() || null;
  const city         = (form.city         ?? '').trim() || null;
  const zip_code     = (form.zip_code     ?? '').trim() || null;
  if ((street?.length ?? 0) > MAX_ADDR_LEN) clientError(`Street is too long (max ${MAX_ADDR_LEN}).`);
  if ((city?.length   ?? 0) > MAX_ADDR_LEN) clientError(`City is too long (max ${MAX_ADDR_LEN}).`);
  if ((zip_code?.length ?? 0) > 20)         clientError('ZIP is too long.');

  // Phone-uniqueness pre-check — duplicate also blocked at DB layer (unique
  // partial index in migration 01), this is for the human-readable 409.
  if (phone_number) {
    const { data: clash } = await sb
      .from('customers')
      .select('customer_number, full_name')
      .eq('phone_number', phone_number)
      .is('archived_at', null)
      .maybeSingle();
    if (clash) {
      clientError(
        `That phone is already in use by ${(clash as any).customer_number} (${(clash as any).full_name}).`,
        409,
        { customer_number: (clash as any).customer_number },
      );
    }
  }

  const { data: num, error: numErr } = await sb.rpc('get_next_customer_number');
  if (numErr) {
    console.error('[db] customer sequence error', numErr);
    throw new Error('Could not generate customer number.');
  }

  const payload = {
    customer_number: num as string,
    full_name,
    phone_number,
    street,
    city,
    zip_code,
    points_balance: 0,
  };

  const { data, error } = await sb.from('customers').insert(payload as any).select().single();
  if (error) {
    console.error('[db] customer insert', error);
    // Could be a race-condition phone collision that slipped past the pre-check.
    if (error.code === '23505') clientError('That phone is already in use.', 409);
    throw new Error('Could not save customer.');
  }
  const customer = data as Customer;

  // Audit must succeed or we roll back the create. Approximates a transaction
  // without the schema-level RPC we'd otherwise need.
  try {
    await logAuditOrFail({
      actor,
      action: 'created',
      entity_type: 'customer',
      entity_id: customer.id,
      entity_label: customer.full_name,
      changes: { ...payload },
    });
  } catch (auditErr) {
    console.error('[db] audit failed for createCustomer — rolling back', auditErr);
    await sb.from('customers').delete().eq('id', customer.id);
    throw new Error('Could not save customer.');
  }

  return customer;
}

// ─────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────

export async function getOrder(id: string): Promise<Order | null> {
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from('orders')
    .select('*, order_items(*), customer:customers(*)')
    .eq('id', id)
    .single();
  return (data as Order) ?? null;
}

export async function getRecentOrders(limit = 10): Promise<Order[]> {
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from('orders')
    .select('*, customer:customers(id, full_name, customer_number)')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as Order[]) ?? [];
}

// Server-side order search. Looks across order_number, notes, customer
// (full_name / phone_number / customer_number), and item name. Falls back to
// most-recent orders when the query is empty so the list view stays useful.
export async function searchOrders(query: string, limit = 50): Promise<Order[]> {
  const sb = createSupabaseAdminClient();
  const q  = query.trim();
  if (!q) return getRecentOrders(limit);

  // Wrap pattern values in PostgREST's quote syntax so commas (and other
  // reserved chars) in the user's input don't mis-parse the OR filter.
  const quote = (pattern: string) => `"${pattern.replace(/"/g, '""')}"`;
  const pat = quote(`%${q}%`);

  // Pre-resolve cross-table matches in parallel — PostgREST `.or()` can't
  // mix conditions across joined tables, so we collect the relevant IDs
  // first and feed them into a single `id.in.(...)` / `customer_id.in.(...)`
  // clause on the orders query.
  const [{ data: matchedCustomers }, { data: matchedItems }] = await Promise.all([
    sb.from('customers')
      .select('id')
      .is('archived_at', null)
      .or(`full_name.ilike.${pat},phone_number.ilike.${pat},customer_number.ilike.${pat}`)
      .limit(200),
    sb.from('order_items')
      .select('order_id')
      .ilike('item_name', `%${q}%`)
      .limit(500),
  ]);

  const customerIds = Array.from(new Set((matchedCustomers ?? []).map((c: any) => c.id as string)));
  const orderIdsByItem = Array.from(new Set((matchedItems ?? []).map((i: any) => i.order_id as string)));

  const orParts = [
    `order_number.ilike.${pat}`,
    `notes.ilike.${pat}`,
  ];
  if (customerIds.length > 0)    orParts.push(`customer_id.in.(${customerIds.join(',')})`);
  if (orderIdsByItem.length > 0) orParts.push(`id.in.(${orderIdsByItem.join(',')})`);

  const { data } = await sb
    .from('orders')
    .select('*, customer:customers(id, full_name, customer_number)')
    .or(orParts.join(','))
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data as Order[]) ?? [];
}

export async function createOrder(form: NewOrderForm, actor: SessionUser): Promise<Order> {
  const sb = createSupabaseAdminClient();

  // Validate inputs BEFORE we touch the sequence.
  if (!form?.customer_id) clientError('A customer is required.');
  validateOrderItems(form.items);
  const notes = (form.notes ?? '').trim() || null;
  if (notes && notes.length > MAX_NOTE_LEN) clientError(`Notes are too long (max ${MAX_NOTE_LEN}).`);

  // payment_method: default to 'cash' if missing (defensive — UI always
  // sends it). Validate explicitly so we never bounce a CHECK violation
  // back to the user.
  const payment_method: PaymentMethod = (() => {
    if (form.payment_method === undefined || form.payment_method === null) return 'cash';
    if (!isPaymentMethod(form.payment_method)) clientError('Invalid payment method.');
    return form.payment_method;
  })();

  // Customer must exist and not be archived (mirrors the PATCH path).
  const { data: cust } = await sb
    .from('customers')
    .select('id, full_name, archived_at, points_balance')
    .eq('id', form.customer_id)
    .maybeSingle();
  if (!cust) clientError('Customer not found.', 404);
  if ((cust as any).archived_at) clientError('That customer has been deleted and cannot receive orders.');

  // Points redemption (optional). Staff types how many points the customer
  // wants to use and the dollar discount that applies. Both default to 0.
  const pointsRedeemed = Math.max(0, Math.floor(Number(form.points_redeemed ?? 0)));
  const rawDiscount    = Math.max(0, Number(form.redemption_discount ?? 0));
  const redemptionDiscount = Math.round(rawDiscount * 100) / 100; // 2-decimal money
  if (pointsRedeemed > 0 || redemptionDiscount > 0) {
    if (!Number.isFinite(pointsRedeemed) || !Number.isFinite(redemptionDiscount)) {
      clientError('Invalid points/discount values.');
    }
    // If they say "use points" they must specify some discount too (or vice
    // versa) — preventing accidental one-sided entries.
    if (pointsRedeemed === 0 && redemptionDiscount > 0) {
      clientError('Enter how many points are being used for this discount.');
    }
    if (pointsRedeemed > 0 && redemptionDiscount === 0) {
      clientError('Enter the dollar discount for the redeemed points.');
    }
    const have = Number((cust as any).points_balance ?? 0);
    if (pointsRedeemed > have) {
      clientError(`Customer has only ${have} points. Cannot redeem ${pointsRedeemed}.`);
    }
  }

  const { data: num, error: numErr } = await sb.rpc('get_next_order_number');
  if (numErr) {
    console.error('[db] order sequence error', numErr);
    throw new Error('Could not generate order number.');
  }

  // Server-stamped timestamp — never trust client time.
  const nowIso = new Date().toISOString();

  const orderPayload = {
    order_number:        num as string,
    customer_id:         form.customer_id,
    order_date:          nowIso,
    subtotal:            0,
    total:               0,
    points_earned:       0,
    points_redeemed:     pointsRedeemed,
    redemption_discount: redemptionDiscount,
    notes,
    status:              'active',
    payment_method,
    created_by:          actor.id,
    created_by_name:     actor.name,
    change_log:          [{ timestamp: nowIso, type: 'created', summary: `Order created by ${actor.name} with ${form.items.length} item${form.items.length !== 1 ? 's' : ''}${pointsRedeemed > 0 ? ` (${pointsRedeemed} pts redeemed for $${redemptionDiscount.toFixed(2)} off)` : ''}` }],
  };

  const { data: order, error: orderErr } = await sb
    .from('orders')
    .insert(orderPayload as any)
    .select()
    .single();
  if (orderErr) {
    console.error('[db] order insert', orderErr);
    throw new Error('Could not save order.');
  }

  const orderId = (order as any).id as string;

  const items = form.items.map((i) => ({
    order_id:   orderId,
    item_name:  i.item_name.trim(),
    quantity:   Number(i.quantity),
    unit_price: Number(i.unit_price),
    line_total: 0,
  }));

  const { error: itemsErr } = await sb.from('order_items').insert(items as any);
  if (itemsErr) {
    console.error('[db] order_items insert', itemsErr);
    // Best-effort cleanup so we don't leak an order shell.
    await sb.from('orders').delete().eq('id', orderId);
    // CHECK violation from migration 01 means the validator missed something.
    if (itemsErr.code === '23514') clientError('One of the items has an invalid quantity or price.');
    throw new Error('Could not save order items.');
  }

  const { data: final, error: fetchErr } = await sb
    .from('orders')
    .select('*, customer:customers(full_name)')
    .eq('id', orderId)
    .single();
  if (fetchErr) {
    console.error('[db] order reload', fetchErr);
    await sb.from('order_items').delete().eq('order_id', orderId);
    await sb.from('orders').delete().eq('id', orderId);
    throw new Error('Could not save order.');
  }

  const finalOrder = final as Order & { customer?: { full_name: string } };

  // ── Points commit happens BEFORE audit so we can detect a concurrent
  //    redemption (DB CHECK 23514 fires when balance would go negative).
  //    If the points call fails, we delete the order (cascades to items)
  //    and abort cleanly before any audit row is written.
  //
  //    Why this order? The in-app `pointsRedeemed > have` check we ran
  //    near the top of this function reads the balance, but another
  //    request can decrement between then and now. The RPC is the only
  //    place that ATOMICALLY checks-and-decrements. Without this guard
  //    the previous code silently swallowed the CHECK error and left an
  //    order on the books with the wrong customer balance.
  const netPointsChange = finalOrder.points_earned - pointsRedeemed;
  if (netPointsChange !== 0) {
    const { error: pointsErr } = await sb.rpc('increment_points' as any, {
      customer_id_input: form.customer_id,
      points_to_add:     netPointsChange,
    });
    if (pointsErr) {
      console.error('[db] increment_points failed — rolling back order', pointsErr);
      // CASCADE on order_items.order_id removes the items.
      await sb.from('orders').delete().eq('id', orderId);
      if ((pointsErr as any).code === '23514') {
        // CHECK constraint: customer's balance would have gone negative.
        // Someone redeemed against the same balance from a concurrent request.
        clientError(
          `Customer does not have enough points to redeem ${pointsRedeemed}. Try again.`,
          409,
        );
      }
      throw new Error('Could not save order — points balance update failed.');
    }
  }

  // Audit AFTER points commit, with compensating rollback if it fails.
  // Rollback reverses both the points change AND the order/items.
  try {
    await logAuditOrFail({
      actor,
      action: 'created',
      entity_type: 'order',
      entity_id: orderId,
      entity_label: `${finalOrder.order_number} — ${finalOrder.customer?.full_name ?? ''}`.trim(),
      changes: {
        customer_id: form.customer_id,
        items: items.map(({ order_id: _, ...rest }) => rest),
        subtotal: finalOrder.subtotal,
        total: finalOrder.total,
        points_earned: finalOrder.points_earned,
        points_redeemed: pointsRedeemed,
        redemption_discount: redemptionDiscount,
        notes: finalOrder.notes,
        payment_method,
      },
    });
  } catch (auditErr) {
    console.error('[db] audit failed for createOrder — rolling back order + points', auditErr);
    // Reverse the points change first (failure here is unrecoverable, but
    // we tried). Then delete the order — items cascade.
    if (netPointsChange !== 0) {
      await sb.rpc('increment_points' as any, {
        customer_id_input: form.customer_id,
        points_to_add:     -netPointsChange,
      });
    }
    await sb.from('orders').delete().eq('id', orderId);
    throw new Error('Could not save order.');
  }

  return finalOrder;
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalCustomers: number;
  totalOrders:    number;
  totalRevenue:   number;
  // Sales at a glance — shop-TZ aware (America/Chicago). Voided orders excluded.
  today_revenue:        number;  today_order_count:        number;
  yesterday_revenue:    number;  yesterday_order_count:    number;
  this_week_revenue:    number;  this_week_order_count:    number;
  this_month_revenue:   number;  this_month_order_count:   number;
  recentCustomers: Customer[];
  recentOrders:    Order[];
}

export async function getDashboardStats(role: 'admin' | 'staff' | 'owner' = 'admin'): Promise<DashboardStats> {
  const sb = createSupabaseAdminClient();
  const isAdmin = role === 'admin' || role === 'owner';

  // Always-loaded basics (visible to both roles).
  const [
    { count: totalCustomers },
    { count: totalOrders },
    { data: recentCustomers },
    { data: recentOrders },
  ] = await Promise.all([
    sb.from('customers').select('*', { count: 'exact', head: true }).is('archived_at', null),
    sb.from('orders').select('*', { count: 'exact', head: true }),
    sb.from('customers').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(5),
    sb.from('orders')
      .select('*, customer:customers(id, full_name, customer_number)')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  // Revenue + time-window aggregates are admin-only. Staff get zeros (and we
  // skip the DB round-trips for them entirely — defense in depth + small perf win).
  let totalRevenue = 0;
  let today_revenue = 0,     today_order_count     = 0;
  let yesterday_revenue = 0, yesterday_order_count = 0;
  let this_week_revenue = 0, this_week_order_count = 0;
  let this_month_revenue = 0,this_month_order_count = 0;

  if (isAdmin) {
    const r = shopRanges();
    const windowQuery = (fromIso: string, toIso: string) =>
      sb.from('orders').select('total').eq('status', 'active').gte('order_date', fromIso).lte('order_date', toIso);

    const [
      { data: rev },
      { data: todayRows },
      { data: yesterdayRows },
      { data: weekRows },
      { data: monthRows },
    ] = await Promise.all([
      sb.from('orders').select('total').eq('status', 'active'),
      windowQuery(r.today.fromIso,      r.today.toIso),
      windowQuery(r.yesterday.fromIso,  r.yesterday.toIso),
      windowQuery(r.this_week.fromIso,  r.this_week.toIso),
      windowQuery(r.this_month.fromIso, r.this_month.toIso),
    ]);

    totalRevenue = ((rev ?? []) as any[]).reduce((s: number, o: any) => s + (o.total ?? 0), 0);
    const sumOf   = (rows: any[] | null) => (rows ?? []).reduce((s, o) => s + Number(o.total ?? 0), 0);
    const countOf = (rows: any[] | null) => (rows ?? []).length;
    today_revenue        = sumOf(todayRows);       today_order_count        = countOf(todayRows);
    yesterday_revenue    = sumOf(yesterdayRows);   yesterday_order_count    = countOf(yesterdayRows);
    this_week_revenue    = sumOf(weekRows);        this_week_order_count    = countOf(weekRows);
    this_month_revenue   = sumOf(monthRows);       this_month_order_count   = countOf(monthRows);
  }

  return {
    totalCustomers:  totalCustomers ?? 0,
    totalOrders:     totalOrders    ?? 0,
    totalRevenue,
    today_revenue,        today_order_count,
    yesterday_revenue,    yesterday_order_count,
    this_week_revenue,    this_week_order_count,
    this_month_revenue,   this_month_order_count,
    recentCustomers: (recentCustomers as Customer[]) ?? [],
    recentOrders:    (recentOrders    as Order[])    ?? [],
  };
}
