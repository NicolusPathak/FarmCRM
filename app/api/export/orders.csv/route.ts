// app/api/export/orders.csv/route.ts
// Admin-only CSV export of orders within a date range. One row per line item.
// Includes voided orders so the owner has full reconciliation history.
import type { NextRequest } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAuditOrFail } from '@/lib/audit';
import { csvLine, attachmentHeader } from '@/lib/csv';
import { parseDateRange, DateRangeError } from '@/lib/date-range';
import { SHOP_TIMEZONE } from '@/lib/utils';
import { safeError } from '@/lib/api-error';

const HEADER = [
  'order_number', 'order_created_at', 'order_status', 'payment_method',
  'customer_number', 'customer_full_name', 'customer_phone',
  'item_name', 'quantity', 'unit_price', 'line_total',
  'order_subtotal', 'order_total', 'voided', 'voided_reason',
];

const BATCH = 200;

function isoLocal(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIMEZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(d);
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? '';
  const off = (parts.find(x => x.type === 'timeZoneName')?.value ?? 'GMT+00:00').replace('GMT', '');
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}${off}`;
}

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  let range;
  try {
    range = parseDateRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));
  } catch (e) {
    if (e instanceof DateRangeError) {
      return new Response(JSON.stringify({ error: e.publicMessage }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return safeError(e, 'Invalid date range.', 'GET /api/export/orders.csv');
  }

  try {
    const sb = createSupabaseAdminClient();

    // Count orders in range first — used for audit row_count.
    const { count: totalCount, error: countErr } = await sb
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('order_date', range.fromIso)
      .lte('order_date', range.toIso);
    if (countErr) {
      console.error('[api:export orders] count', countErr);
      return safeError(countErr, 'Could not run export.', 'GET /api/export/orders.csv');
    }

    // Audit BEFORE streaming. Fail-closed.
    await logAuditOrFail({
      actor: auth.user,
      action: 'export.orders',
      entity_type: 'export',
      entity_label: 'orders_export',
      changes: {
        row_count: totalCount ?? 0,
        date_from: range.fromIso,
        date_to:   range.toIso,
      },
    });

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          // UTF-8 BOM so Excel reads accented names correctly.
          controller.enqueue(enc.encode('﻿' + csvLine(HEADER) + '\r\n'));

          let offset = 0;
          for (;;) {
            const { data, error } = await sb
              .from('orders')
              .select(`
                id, order_number, order_date, subtotal, total, status, notes, payment_method,
                customer:customers(customer_number, full_name, phone_number),
                order_items(item_name, quantity, unit_price, line_total)
              `)
              .gte('order_date', range.fromIso)
              .lte('order_date', range.toIso)
              .order('order_date', { ascending: true })
              .order('id', { ascending: true }) // tiebreaker — stable pagination across batches
              .range(offset, offset + BATCH - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;

            for (const o of data as any[]) {
              const isVoid = o.status === 'void';
              const customer = o.customer ?? {};
              const items = (o.order_items ?? []) as any[];

              // voided_reason isn't modeled yet; emit empty.
              const paymentMethod = o.payment_method ?? 'cash';
              if (items.length === 0) {
                controller.enqueue(enc.encode(csvLine([
                  o.order_number, isoLocal(o.order_date), o.status, paymentMethod,
                  customer.customer_number ?? '', customer.full_name ?? '', customer.phone_number ?? '',
                  '', '', '', '',
                  Number(o.subtotal ?? 0).toFixed(2),
                  Number(o.total ?? 0).toFixed(2),
                  isVoid ? 'yes' : 'no',
                  '',
                ]) + '\r\n'));
              } else {
                for (const it of items) {
                  controller.enqueue(enc.encode(csvLine([
                    o.order_number, isoLocal(o.order_date), o.status, paymentMethod,
                    customer.customer_number ?? '', customer.full_name ?? '', customer.phone_number ?? '',
                    it.item_name,
                    Number(it.quantity ?? 0),
                    Number(it.unit_price ?? 0).toFixed(2),
                    Number(it.line_total ?? 0).toFixed(2),
                    Number(o.subtotal ?? 0).toFixed(2),
                    Number(o.total ?? 0).toFixed(2),
                    isVoid ? 'yes' : 'no',
                    '',
                  ]) + '\r\n'));
                }
              }
            }

            if (data.length < BATCH) break;
            offset += BATCH;
          }
          controller.close();
        } catch (streamErr) {
          console.error('[api:export orders] stream', streamErr);
          controller.error(new Error('Export stream failed.'));
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachmentHeader(`orders_${range.fromLabel}_to_${range.toLabel}.csv`),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return safeError(err, 'Could not run export.', 'GET /api/export/orders.csv');
  }
}
