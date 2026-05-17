// app/api/export/audit.csv/route.ts
// Admin-only CSV export of audit log entries within a date range. The
// changes_json column is the raw JSONB serialized as a single-line JSON
// string (CSV-escaped). The owner can paste a single cell into a JSON
// viewer if they need to dig into a specific event.
import type { NextRequest } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { logAuditOrFail } from '@/lib/audit';
import { csvLine, attachmentHeader } from '@/lib/csv';
import { parseDateRange, DateRangeError } from '@/lib/date-range';
import { SHOP_TIMEZONE } from '@/lib/utils';
import { safeError } from '@/lib/api-error';

const HEADER = [
  'created_at', 'actor_id', 'actor_name', 'actor_role',
  'action', 'entity_type', 'entity_id', 'entity_label',
  'changes_json', 'ip_address', 'user_agent',
];

const BATCH = 500;

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
    return safeError(e, 'Invalid date range.', 'GET /api/export/audit.csv');
  }

  try {
    const sb = createSupabaseAdminClient();

    const { count: totalCount, error: countErr } = await sb
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', range.fromIso)
      .lte('created_at', range.toIso);
    if (countErr) {
      console.error('[api:export audit] count', countErr);
      return safeError(countErr, 'Could not run export.', 'GET /api/export/audit.csv');
    }

    // Audit BEFORE streaming. Fail-closed.
    await logAuditOrFail({
      actor: auth.user,
      action: 'export.audit',
      entity_type: 'export',
      entity_label: 'audit_export',
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
              .from('audit_log')
              .select('id, created_at, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, changes')
              .gte('created_at', range.fromIso)
              .lte('created_at', range.toIso)
              .order('created_at', { ascending: true })
              .order('id', { ascending: true }) // tiebreaker — stable pagination across batches
              .range(offset, offset + BATCH - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;

            for (const r of data as any[]) {
              const changes = r.changes ?? {};
              const meta = (changes && typeof changes === 'object' && changes._meta) ? changes._meta : {};
              // Strip _meta out of the changes JSON we expose, so the
              // change payload stays clean and IP/UA show as their own cells.
              const changesClean = { ...changes };
              delete changesClean._meta;

              controller.enqueue(enc.encode(csvLine([
                isoLocal(r.created_at),
                r.actor_id ?? '',
                r.actor_name ?? '',
                r.actor_role ?? '',
                r.action ?? '',
                r.entity_type ?? '',
                r.entity_id ?? '',
                r.entity_label ?? '',
                JSON.stringify(changesClean),
                meta.ip ?? '',
                meta.user_agent ?? '',
              ]) + '\r\n'));
            }

            if (data.length < BATCH) break;
            offset += BATCH;
          }
          controller.close();
        } catch (streamErr) {
          console.error('[api:export audit] stream', streamErr);
          controller.error(new Error('Export stream failed.'));
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachmentHeader(`audit_${range.fromLabel}_to_${range.toLabel}.csv`),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return safeError(err, 'Could not run export.', 'GET /api/export/audit.csv');
  }
}
