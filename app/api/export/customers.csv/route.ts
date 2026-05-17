// app/api/export/customers.csv/route.ts
// Admin-only CSV export of every active customer. Streams the response.
// Audit-first: row count is captured into audit_log BEFORE any byte streams
// to the client, so a failed audit cancels the export with a clean 500.
import type { NextRequest } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAuditOrFail } from '@/lib/audit';
import { csvLine, attachmentHeader } from '@/lib/csv';
import { SHOP_TIMEZONE } from '@/lib/utils';
import { safeError } from '@/lib/api-error';

// Only columns we actually have. Previous versions exported `email`, `state`,
// and `updated_at` as blanks / created_at-mirror — misleading because the
// header promised data the schema doesn't model. Honest blank is better.
const HEADER = [
  'customer_number', 'full_name', 'phone_number',
  'street', 'city', 'zip_code',
  'loyalty_points', 'total_lifetime_spend', 'total_orders',
  'created_at',
];

const BATCH = 500;

// ISO 8601 string in SHOP_TIMEZONE (e.g. 2026-05-14T11:23:00-05:00)
function isoLocal(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  // Format as YYYY-MM-DDTHH:mm:ss±HH:MM in the shop timezone.
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

function todayYMD(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

export async function GET(_req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  try {
    const sb = createSupabaseAdminClient();

    // 1. Count first — audit reflects the row count the export will produce.
    const { count: totalCount, error: countErr } = await sb
      .from('customers').select('id', { count: 'exact', head: true }).is('archived_at', null);
    if (countErr) {
      console.error('[api:export customers] count', countErr);
      return safeError(countErr, 'Could not run export.', 'GET /api/export/customers.csv');
    }
    const rowCount = totalCount ?? 0;

    // 2. Audit BEFORE streaming. If audit fails, return 500 with no body.
    await logAuditOrFail({
      actor: auth.user,
      action: 'export.customers',
      entity_type: 'export',
      entity_label: 'customers_export',
      changes: { row_count: rowCount, date_from: null, date_to: null },
    });

    // 3. Stream the body. If the SELECT pages fail mid-way, the connection
    // drops and the client gets a truncated CSV — the audit row already
    // accurately recorded the intended export.
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          // UTF-8 BOM so Excel reads accented names correctly instead of
          // showing Müller as "Müller". Google Sheets / LibreOffice ignore it.
          controller.enqueue(enc.encode('﻿' + csvLine(HEADER) + '\r\n'));

          let offset = 0;
          for (;;) {
            const { data, error } = await sb
              .from('customers')
              .select('id, customer_number, full_name, phone_number, street, city, zip_code, points_balance, created_at')
              .is('archived_at', null)
              .order('created_at', { ascending: true })
              .order('id', { ascending: true }) // tiebreaker — stable pagination
              .range(offset, offset + BATCH - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;

            // Per-customer aggregates for this batch: lifetime spend + order count.
            const custIds = data.map((r: any) => r.id);
            const { data: orderAgg } = await sb
              .from('orders')
              .select('customer_id, total')
              .in('customer_id', custIds)
              .eq('status', 'active');
            const agg = new Map<string, { count: number; spend: number }>();
            for (const o of orderAgg ?? []) {
              const k = (o as any).customer_id;
              const cur = agg.get(k) ?? { count: 0, spend: 0 };
              cur.count += 1;
              cur.spend += Number((o as any).total) || 0;
              agg.set(k, cur);
            }

            for (const r of data as any[]) {
              const a = agg.get(r.id) ?? { count: 0, spend: 0 };
              controller.enqueue(enc.encode(csvLine([
                r.customer_number,
                r.full_name,
                r.phone_number ?? '',
                r.street ?? '',
                r.city ?? '',
                r.zip_code ?? '',
                r.points_balance ?? 0,
                a.spend.toFixed(2),
                a.count,
                isoLocal(r.created_at),
              ]) + '\r\n'));
            }

            if (data.length < BATCH) break;
            offset += BATCH;
          }
          controller.close();
        } catch (streamErr) {
          console.error('[api:export customers] stream', streamErr);
          controller.error(new Error('Export stream failed.'));
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachmentHeader(`customers_${todayYMD()}.csv`),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return safeError(err, 'Could not run export.', 'GET /api/export/customers.csv');
  }
}
