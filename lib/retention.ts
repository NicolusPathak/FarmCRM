// lib/retention.ts — Classify customers into retention concern buckets.
// Server-only. Uses the service-role client (no RLS).
import 'server-only';
import { cache } from 'react';
import { createSupabaseAdminClient } from './supabase-server';
import type { Customer } from '@/types';
import {
  DEFAULT_SETTINGS,
  type RetentionBucket,
  type RetentionSettings,
  type RetentionCustomer,
  type RetentionResult,
} from './retention-types';

export type { RetentionBucket, RetentionSettings, RetentionCustomer, RetentionResult } from './retention-types';
export { DEFAULT_SETTINGS } from './retention-types';

// Cached per-request (admin pages may read this multiple times)
export const getRetentionSettings = cache(async (): Promise<RetentionSettings> => {
  const sb = createSupabaseAdminClient();
  const { data } = await sb.from('app_settings').select('value').eq('key', 'retention').maybeSingle();
  const v = (data as any)?.value ?? null;
  if (!v) return DEFAULT_SETTINGS;
  return {
    cold_days:               Number(v.cold_days)               || DEFAULT_SETTINGS.cold_days,
    one_time_days:           Number(v.one_time_days)           || DEFAULT_SETTINGS.one_time_days,
    slipping_avg_gap_cap:    Number(v.slipping_avg_gap_cap)    || DEFAULT_SETTINGS.slipping_avg_gap_cap,
    slipping_multiplier:     Number(v.slipping_multiplier)     || DEFAULT_SETTINGS.slipping_multiplier,
    contacted_suppress_days: Number(v.contacted_suppress_days) || DEFAULT_SETTINGS.contacted_suppress_days,
  };
});

// `actorId` is the staff_users.id for admin actors, or null for the owner.
// Owners don't have a staff_users row, so passing their owner_credentials UUID
// here would violate the FK on app_settings.updated_by.
export async function updateRetentionSettings(next: Partial<RetentionSettings>, actorId: string | null): Promise<RetentionSettings> {
  const sb = createSupabaseAdminClient();
  const current = await getRetentionSettings();
  const merged: RetentionSettings = { ...current, ...next };
  // Hard-bound sane ranges
  merged.cold_days               = clamp(merged.cold_days, 7, 365);
  merged.one_time_days           = clamp(merged.one_time_days, 7, 365);
  merged.slipping_avg_gap_cap    = clamp(merged.slipping_avg_gap_cap, 3, 120);
  merged.slipping_multiplier     = clamp(merged.slipping_multiplier, 1.1, 5);
  merged.contacted_suppress_days = clamp(merged.contacted_suppress_days, 0, 90);
  await sb.from('app_settings').upsert({
    key: 'retention', value: merged, updated_at: new Date().toISOString(), updated_by: actorId,
  } as any, { onConflict: 'key' });
  return merged;
}

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

// Pulls and per-compute limits. Both raised well above realistic scale so we
// won't silently miss data, but kept finite as a defense against runaway
// memory if the table ever explodes.
const MAX_CUSTOMERS = 50_000;
// Orders older than this can't influence any retention bucket — cold_days /
// one_time_days are both bounded at 365 by the settings clamps. A two-year
// window is generous enough to be safely inclusive without dragging the
// entire orders history through memory on every admin page-load.
const ORDERS_LOOKBACK_DAYS = 730;

const DAY = 86_400_000;

// Median over an array of non-negative numbers. Empty → null.
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Compute retention buckets across the customer base.
export const computeRetention = cache(async (): Promise<RetentionResult> => {
  const sb = createSupabaseAdminClient();
  const settings = await getRetentionSettings();

  // 1. All non-archived customers
  const { data: customers } = await sb
    .from('customers')
    .select('*')
    .is('archived_at', null)
    .limit(MAX_CUSTOMERS);
  const list = (customers ?? []) as Customer[];
  if (list.length >= MAX_CUSTOMERS) {
    // Surface in logs so we notice before customers go silently missing.
    console.error(
      `[retention] customer cap hit (${MAX_CUSTOMERS}). Some customers are being excluded from retention. Raise MAX_CUSTOMERS or paginate.`,
    );
  }

  // 2. All active order dates per customer within the lookback window.
  // Without the date filter this loaded the entire orders history every time
  // the retention page rendered (and once again for the sidebar badge).
  const lookbackCutoff = new Date(Date.now() - ORDERS_LOOKBACK_DAYS * DAY).toISOString();
  const { data: orders } = await sb
    .from('orders')
    .select('customer_id, order_date')
    .eq('status', 'active')
    .gte('order_date', lookbackCutoff)
    .order('order_date', { ascending: true });
  type Ord = { customer_id: string; order_date: string };
  const byCust = new Map<string, string[]>();
  for (const o of (orders ?? []) as Ord[]) {
    const arr = byCust.get(o.customer_id) ?? [];
    arr.push(o.order_date);
    byCust.set(o.customer_id, arr);
  }

  const now = Date.now();
  const suppressMs = settings.contacted_suppress_days * DAY;

  const slipping:  RetentionCustomer[] = [];
  const cold:      RetentionCustomer[] = [];
  const one_time:  RetentionCustomer[] = [];

  for (const c of list) {
    const dates = byCust.get(c.id) ?? [];
    const orderCount = dates.length;
    if (orderCount === 0) continue; // never bought → not "lost" yet

    // Suppress recently-contacted customers
    if ((c as any).last_contacted_at) {
      const since = now - new Date((c as any).last_contacted_at).getTime();
      if (since < suppressMs) continue;
    }

    const lastTs  = new Date(dates[dates.length - 1]).getTime();
    const firstTs = new Date(dates[0]).getTime();
    const daysSinceLast = Math.floor((now - lastTs) / DAY);

    // Median of the actual gaps between consecutive orders. More honest than
    // a uniform "(total span) / (n-1)" average for bursty customers — a
    // customer who orders three times in a week then disappears for a year
    // should not be reported as "ordering every 4 months."
    let medianGap: number | null = null;
    if (orderCount >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < dates.length; i++) {
        const a = new Date(dates[i - 1]).getTime();
        const b = new Date(dates[i]).getTime();
        gaps.push((b - a) / DAY);
      }
      medianGap = median(gaps);
    }

    const base: RetentionCustomer = {
      customer: c,
      bucket: 'cold',
      last_order_at: dates[dates.length - 1],
      first_order_at: dates[0],
      order_count: orderCount,
      days_since_last: daysSinceLast,
      median_gap_days: medianGap,
      last_contacted_at: (c as any).last_contacted_at ?? null,
    };

    // ── Classification (most-specific wins) ───────────────────
    if (orderCount === 1 && daysSinceLast >= settings.one_time_days) {
      one_time.push({ ...base, bucket: 'one_time' });
      continue;
    }

    if (
      orderCount >= 3 && medianGap !== null &&
      medianGap < settings.slipping_avg_gap_cap &&
      daysSinceLast > medianGap * settings.slipping_multiplier &&
      daysSinceLast >= 14 // require at least 2 weeks gap even for high-frequency customers
    ) {
      slipping.push({ ...base, bucket: 'slipping' });
      continue;
    }

    if (orderCount >= 2 && daysSinceLast >= settings.cold_days) {
      cold.push({ ...base, bucket: 'cold' });
      continue;
    }
  }

  // Sort each bucket by urgency (highest days_since_last first)
  const byUrgency = (a: RetentionCustomer, b: RetentionCustomer) => b.days_since_last - a.days_since_last;
  slipping.sort(byUrgency);
  cold.sort(byUrgency);
  one_time.sort(byUrgency);

  return {
    slipping, cold, one_time,
    total: slipping.length + cold.length + one_time.length,
    settings,
  };
});
