// lib/report.ts — Sales report aggregation (single day OR date range).
//
// One function, `getReport(from, to)`, builds the report for any window.
// When from === to the response also carries a 7-day per-item sparkline
// trend and a yesterday-comparison delta — the things that only make
// sense at "end of day" granularity. When from < to those fields are
// either empty or replaced with the equal-length previous-window delta.
// Daily totals across the focal window are always populated and power
// the bar chart on the report page.

import { createSupabaseAdminClient } from './supabase-server';
import { shopDayBoundaryMs, shopShiftYMD, shopYMD } from './utils';
import {
  buildCategoryIndex,
  looksLikeSameSpelling,
  matchCategory,
  mergeFuzzyBuckets,
  normalizeItemName,
  type RawBucket,
} from './categories';
import type {
  CategoryAlias,
  CategoryWithAliases,
  ProductCategory,
  ReportCategoryRow,
  ReportData,
  ReportItemRow,
} from '@/types';

const UNCATEGORIZED_COLOR = '#94a3b8';
const UNCATEGORIZED_NAME  = 'Uncategorized';
const TREND_DAYS          = 7;     // sparkline window when from === to
const TREND_TOP_N         = 3;
const MAX_RANGE_DAYS      = 366;   // matches the export limit; refuse anything wider

// ─────────────────────────────────────────────────────────────
// Category + alias loader
// ─────────────────────────────────────────────────────────────

export async function loadCategoriesWithAliases(): Promise<CategoryWithAliases[]> {
  const sb = createSupabaseAdminClient();

  const [{ data: cats }, { data: aliases }] = await Promise.all([
    sb.from('product_categories')
      .select('id, name, color, sort_order, archived_at, created_at, updated_at')
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('name',       { ascending: true }),
    sb.from('category_aliases')
      .select('id, category_id, alias, alias_normalized, created_at'),
  ]);

  const aliasByCat = new Map<string, CategoryAlias[]>();
  for (const a of ((aliases as CategoryAlias[]) ?? [])) {
    const arr = aliasByCat.get(a.category_id) ?? [];
    arr.push(a);
    aliasByCat.set(a.category_id, arr);
  }

  return ((cats as ProductCategory[]) ?? []).map(c => ({
    ...c,
    aliases: aliasByCat.get(c.id) ?? [],
  }));
}

// ─────────────────────────────────────────────────────────────
// Core report
// ─────────────────────────────────────────────────────────────

interface OrderItemRow {
  order_id: string;
  item_name: string;
  quantity: number;
  line_total: number;
  orders: { order_date: string; status: string } | null;
}

// Pull all active line items in the inclusive UTC window in batches.
async function loadItemsForWindow(fromIso: string, toIso: string): Promise<OrderItemRow[]> {
  const sb = createSupabaseAdminClient();
  const BATCH = 500;
  const out: OrderItemRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from('order_items')
      .select('order_id, item_name, quantity, line_total, orders!inner(order_date, status)')
      .eq('orders.status', 'active')
      .gte('orders.order_date', fromIso)
      .lte('orders.order_date', toIso)
      .order('order_id', { ascending: true })
      .range(offset, offset + BATCH - 1);
    if (error) throw error;
    const rows = (data as unknown as OrderItemRow[]) ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < BATCH) break;
    offset += BATCH;
  }
  return out;
}

function bucketize(rows: OrderItemRow[], matchFn: (n: string) => string | null): RawBucket[] {
  const buckets = new Map<string, RawBucket>();
  for (const r of rows) {
    const norm = normalizeItemName(r.item_name);
    if (!norm) continue;
    let b = buckets.get(norm);
    if (!b) {
      b = {
        normalized_name: norm,
        display_name:    r.item_name.trim() || norm,
        category_id:     matchFn(norm),
        revenue:         0,
        quantity:        0,
        order_ids:       new Set<string>(),
        spellings:       new Map<string, number>(),
      };
      buckets.set(norm, b);
    }
    b.revenue  += Number(r.line_total ?? 0);
    b.quantity += Number(r.quantity ?? 0);
    b.order_ids.add(r.order_id);
    const sp = r.item_name.trim();
    if (sp) b.spellings.set(sp, (b.spellings.get(sp) ?? 0) + 1);
  }
  return [...buckets.values()];
}

export class ReportRangeError extends Error {
  status = 400;
  publicMessage: string;
  constructor(msg: string) { super(msg); this.publicMessage = msg; }
}

export async function getReport(from: string, to: string): Promise<ReportData> {
  if (from > to) throw new ReportRangeError('"from" must be on or before "to".');
  const focalDays = daysBetween(from, to) + 1;
  if (focalDays > MAX_RANGE_DAYS) {
    throw new ReportRangeError(`Range too large — pick ${MAX_RANGE_DAYS} days or fewer.`);
  }

  const isSingleDay = from === to;

  // Pull extra history alongside the focal window:
  //   - Single day:  6 prior days for sparklines (covers yesterday too).
  //   - Range:       equal-length previous window for the delta.
  const histShift = isSingleDay ? (TREND_DAYS - 1) : focalDays;
  const histStart = shopShiftYMD(from, -histShift);
  const fromIso   = new Date(shopDayBoundaryMs(histStart, false)).toISOString();
  const toIso     = new Date(shopDayBoundaryMs(to,        true )).toISOString();

  const [rows, cats] = await Promise.all([
    loadItemsForWindow(fromIso, toIso),
    loadCategoriesWithAliases(),
  ]);
  const idx = buildCategoryIndex(cats);
  const match = (n: string) => matchCategory(n, idx);

  // Focal-window rows
  const focalStart = shopDayBoundaryMs(from, false);
  const focalEnd   = shopDayBoundaryMs(to,   true);
  const focalRows  = rows.filter(r => {
    const t = r.orders ? Date.parse(r.orders.order_date) : NaN;
    return t >= focalStart && t <= focalEnd;
  });

  // Bucket the focal items, fuzzy-merge near-spellings.
  const { merged, merges } = mergeFuzzyBuckets(bucketize(focalRows, match));

  // Item rows + category rollups.
  const catRollup = new Map<string | null, ReportCategoryRow>();
  const items: ReportItemRow[] = merged.map(b => {
    const cat = b.category_id ? idx.byId.get(b.category_id) : null;
    const catName  = cat ? cat.name  : UNCATEGORIZED_NAME;
    const catColor = cat ? cat.color : UNCATEGORIZED_COLOR;

    const key = b.category_id ?? null;
    const rc = catRollup.get(key) ?? {
      id: key, name: catName, color: catColor,
      revenue: 0, quantity: 0, item_count: 0,
    };
    rc.revenue    += b.revenue;
    rc.quantity   += b.quantity;
    rc.item_count += 1;
    catRollup.set(key, rc);

    const mergedFrom = [...b.spellings.keys()].filter(s => s !== b.display_name);
    return {
      display_name:    b.display_name,
      normalized_name: b.normalized_name,
      category_id:     b.category_id,
      category_name:   catName,
      category_color:  catColor,
      revenue:         round2(b.revenue),
      quantity:        round3(b.quantity),
      order_count:     b.order_ids.size,
      merged_from:     mergedFrom,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const categories: ReportCategoryRow[] = [...catRollup.values()].map(rc => ({
    ...rc, revenue: round2(rc.revenue), quantity: round3(rc.quantity),
  })).sort((a, b) => {
    if (a.id === null) return  1;
    if (b.id === null) return -1;
    const ai = idx.byId.get(a.id)?.sort_order ?? 999;
    const bi = idx.byId.get(b.id)?.sort_order ?? 999;
    return ai - bi || a.name.localeCompare(b.name);
  });

  // Headline KPIs.
  const total_revenue = round2(items.reduce((s, r) => s + r.revenue, 0));
  const total_items   = round3(items.reduce((s, r) => s + r.quantity, 0));
  const total_orders  = new Set(focalRows.map(r => r.order_id)).size;

  // Daily totals across the focal window — always populated. Powers the
  // range-mode bar chart and is also handy on single-day views (it just
  // happens to have one bar).
  const daily_totals: ReportData['daily_totals'] = [];
  for (let i = 0; i < focalDays; i++) {
    const d = shopShiftYMD(from, i);
    const s = shopDayBoundaryMs(d, false);
    const e = shopDayBoundaryMs(d, true);
    let rev = 0;
    const orderIds = new Set<string>();
    for (const r of focalRows) {
      if (!r.orders) continue;
      const t = Date.parse(r.orders.order_date);
      if (t < s || t > e) continue;
      rev += Number(r.line_total ?? 0);
      orderIds.add(r.order_id);
    }
    daily_totals.push({ date: d, revenue: round2(rev), orders: orderIds.size });
  }

  // Previous-window comparison.
  //   - Single day:  prior day.
  //   - Range:       equal-length window ending the day before `from`.
  const prevTo   = shopShiftYMD(from, -1);
  const prevFrom = shopShiftYMD(from, -focalDays);
  const prevStart = shopDayBoundaryMs(prevFrom, false);
  const prevEnd   = shopDayBoundaryMs(prevTo,   true);
  const prevRows  = rows.filter(r => {
    const t = r.orders ? Date.parse(r.orders.order_date) : NaN;
    return t >= prevStart && t <= prevEnd;
  });
  const prev_revenue = round2(prevRows.reduce((s, r) => s + Number(r.line_total ?? 0), 0));
  const prev_orders  = new Set(prevRows.map(r => r.order_id)).size;
  const prev_label   = isSingleDay
    ? 'vs yesterday'
    : `vs prior ${focalDays === 1 ? 'day' : `${focalDays} days`}`;

  // Per-item sparkline trend — only for single-day. In range mode the
  // daily-totals chart is the relevant trend visual.
  const trend_dates: string[] = [];
  const trend_by_item: ReportData['trend_by_item'] = [];
  if (isSingleDay) {
    for (let i = TREND_DAYS - 1; i >= 0; i--) trend_dates.push(shopShiftYMD(from, -i));
    for (const top of items.slice(0, TREND_TOP_N)) {
      const daily_revenue = trend_dates.map(d => {
        const s = shopDayBoundaryMs(d, false);
        const e = shopDayBoundaryMs(d, true);
        let sum = 0;
        for (const r of rows) {
          if (!r.orders) continue;
          const t = Date.parse(r.orders.order_date);
          if (t < s || t > e) continue;
          const n = normalizeItemName(r.item_name);
          if (n === top.normalized_name) { sum += Number(r.line_total ?? 0); continue; }
          // Cross-category fuzzy merges are unsafe — same guard as
          // mergeFuzzyBuckets.
          const itemCat = match(n);
          if ((itemCat ?? null) !== (top.category_id ?? null)) continue;
          if (looksLikeSameSpelling(n, top.normalized_name)) sum += Number(r.line_total ?? 0);
        }
        return round2(sum);
      });
      trend_by_item.push({
        normalized_name: top.normalized_name,
        display_name:    top.display_name,
        category_color:  top.category_color,
        daily_revenue,
      });
    }
  }

  const uncategorized_count = items.filter(i => i.category_id === null).length;

  return {
    from, to,
    is_single_day:   isSingleDay,
    total_revenue,
    total_orders,
    total_items,
    prev_revenue,
    prev_orders,
    prev_label,
    categories,
    items,
    daily_totals,
    trend_dates,
    trend_by_item,
    merges,
    uncategorized_count,
  };
}

// Inclusive day count between two shop-TZ YYYY-MM-DD strings.
function daysBetween(from: string, to: string): number {
  const f = shopDayBoundaryMs(from, false);
  const t = shopDayBoundaryMs(to,   false);
  return Math.round((t - f) / 86_400_000);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }

export function defaultReportDate(): string {
  return shopYMD();
}
