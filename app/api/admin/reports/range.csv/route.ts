// app/api/admin/reports/range.csv/route.ts — Sales report as CSV.
//
// One row per item bucket, a per-category subtotal row, and a grand
// total. Mirrors what the report page shows on-screen.
import type { NextRequest } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { logAuditOrFail } from '@/lib/audit';
import { csvLine, attachmentHeader } from '@/lib/csv';
import { safeError } from '@/lib/api-error';
import { defaultReportDate, getReport, ReportRangeError } from '@/lib/report';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

const HEADER = [
  'period_from', 'period_to', 'category', 'item',
  'quantity', 'revenue', 'orders', 'merged_from',
];

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const today = defaultReportDate();
  const from  = req.nextUrl.searchParams.get('from') ?? today;
  const to    = req.nextUrl.searchParams.get('to')   ?? from;

  if (!YYYY_MM_DD.test(from) || !YYYY_MM_DD.test(to)) {
    return err(400, 'from/to must be YYYY-MM-DD');
  }
  if (to > today) return err(400, '"to" cannot be in the future');

  let report;
  try {
    report = await getReport(from, to);
  } catch (e) {
    if (e instanceof ReportRangeError) return err(e.status, e.publicMessage);
    return safeError(e, 'Could not build CSV.', 'GET /api/admin/reports/range.csv');
  }

  try {
    await logAuditOrFail({
      actor: auth.user,
      action: 'export.orders',
      entity_type: 'export',
      entity_label: from === to ? `daily_report_${from}` : `report_${from}_to_${to}`,
      changes: {
        from, to,
        row_count: report.items.length,
        categories: report.categories.length,
        total_revenue: report.total_revenue,
      },
    });
  } catch (e) {
    return safeError(e, 'Could not run export.', 'GET /api/admin/reports/range.csv');
  }

  const filename = from === to
    ? `daily_report_${from}.csv`
    : `report_${from}_to_${to}.csv`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      try {
        controller.enqueue(enc.encode('﻿' + csvLine(HEADER) + '\r\n'));

        for (const cat of report.categories) {
          const itemsInCat = report.items.filter(i =>
            (i.category_id ?? null) === (cat.id ?? null));
          for (const it of itemsInCat) {
            controller.enqueue(enc.encode(csvLine([
              from, to, cat.name, it.display_name,
              it.quantity, it.revenue.toFixed(2), it.order_count,
              it.merged_from.join(' | '),
            ]) + '\r\n'));
          }
          controller.enqueue(enc.encode(csvLine([
            from, to, cat.name, `(${cat.name} total)`,
            cat.quantity, cat.revenue.toFixed(2), '', '',
          ]) + '\r\n'));
        }

        controller.enqueue(enc.encode(csvLine([
          from, to, '', '(Grand total)',
          report.total_items, report.total_revenue.toFixed(2),
          report.total_orders, '',
        ]) + '\r\n'));

        controller.close();
      } catch (e) {
        console.error('[api:reports range.csv] stream', e);
        controller.error(new Error('CSV stream failed.'));
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': attachmentHeader(filename),
      'Cache-Control': 'no-store',
    },
  });
}
