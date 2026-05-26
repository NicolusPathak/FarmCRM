// lib/report.ts — Sales report aggregation, bucketed by product catalog group.
//
// Bucketing model (post-migration 10):
//   Every order_items row may carry `product_code`. The report groups
//   items by the corresponding product's `group_code` (e.g. 'poultry',
//   'whole_goat', 'retail_goat', 'eggs'). For legacy rows where
//   product_code is NULL — orders entered before the catalog UI shipped —
//   we fall back to a case-insensitive match of `item_name` against the
//   catalog's product `name`. Anything still unmatched lands in "Other".
//
// What this file used to do (and no longer does):
//   It loaded `product_categories` + `category_aliases` and ran a
//   bounded Levenshtein "fuzzy merge" against free-text item names.
//   With a fixed-card catalog the item identity is known at write
//   time, so all of that goes away. The old admin "map this typo to a
//   category" UI is removed too.

import { createSupabaseAdminClient } from './supabase-server';
import { shopDayBoundaryMs, shopShiftYMD, shopYMD } from './utils';
import { listProducts } from './products';
import type {
  Product,
  ReportCategoryRow,
  ReportData,
  ReportItemRow,
} from '@/types';

// Legacy "no group" bucket — orders that pre-date the catalog OR a
// line item whose product was archived and renamed beyond recognition.
const OTHER_KEY   = 'other';
const OTHER_NAME  = 'Other';
const OTHER_COLOR = '#94a3b8';

const TREND_DAYS     = 7;     // sparkline window for single-day reports
const TREND_TOP_N    = 3;
const MAX_RANGE_DAYS = 366;   // refuse anything wider — matches the export limit

// ─────────────────────────────────────────────────────────────
// Catalog index — lookups we use during aggregation.
// ─────────────────────────────────────────────────────────────

interface CatalogIndex {
  byCode:        Map<string, Product>;
  // lowercased product name → product (for legacy item_name fallback)
  byLowerName:   Map<string, Product>;
  // group_code → display info inherited from the lowest-sorted product
  groupMeta:     Map<string, { name: string; color: string; sort: number }>;
}

function buildIndex(products: Product[]): CatalogIndex {
  const byCode      = new Map<string, Product>();
  const byLowerName = new Map<string, Product>();
  const groupMeta   = new Map<string, { name: string; color: string; sort: number }>();

  // Process by sort_order so the group's display info comes from its
  // canonical (lowest-sorted) row — matches what the order entry UI shows.
  const sorted = [...products].sort((a, b) => a.sort_order - b.sort_order);
  for (const p of sorted) {
    byCode.set(p.code, p);
    const ln = p.name.trim().toLowerCase();
    if (ln && !byLowerName.has(ln)) byLowerName.set(ln, p);
    if (!groupMeta.has(p.group_code)) {
      groupMeta.set(p.group_code, {
        name:  p.group_label,
        color: p.accent_color || OTHER_COLOR,
        sort:  p.sort_order,
      });
    }
  }
  return { byCode, byLowerName, groupMeta };
}

// Pick the bucket a single line item belongs to. Returns `null` if the
// item can't be placed (legacy text we don't recognize).
function bucketFor(
  item: { item_name: string; product_code: string | null | undefined },
  idx: CatalogIndex,
): { groupCode: string; productCode: string | null } | null {
  const code = (item.product_code ?? '').trim();
  if (code) {
    // Service-fee helper lines carry 'service_fee:<base-code>' and bucket
    // with their base product.
    const baseCode = code.startsWith('service_fee:') ? code.slice('service_fee:'.length) : code;
    const p = idx.byCode.get(baseCode);
    if (p) return { groupCode: p.group_code, productCode: p.code };
  }
  // Legacy fallback — case-insensitive exact match of the displayed name.
  const ln = item.item_name.trim().toLowerCase();
  if (ln) {
    const p = idx.byLowerName.get(ln);
    if (p) return { groupCode: p.group_code, productCode: p.code };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Order items loader
// ─────────────────────────────────────────────────────────────

interface OrderItemRow {
  order_id: string;
  item_name: string;
  quantity: number;
  line_total: number;
  product_code: string | null;
  orders: { order_date: string; status: string } | null;
}

async function loadItemsForWindow(fromIso: string, toIso: string): Promise<OrderItemRow[]> {
  const sb = createSupabaseAdminClient();
  const BATCH = 500;
  const out: OrderItemRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from('order_items')
      .select('order_id, item_name, quantity, line_total, product_code, orders!inner(order_date, status)')
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

// ─────────────────────────────────────────────────────────────
// Errors + entrypoint
// ─────────────────────────────────────────────────────────────

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
  //   - Single day:  6 prior days for sparklines (covers yesterday).
  //   - Range:       equal-length previous window for the delta.
  const histShift = isSingleDay ? (TREND_DAYS - 1) : focalDays;
  const histStart = shopShiftYMD(from, -histShift);
  const fromIso   = new Date(shopDayBoundaryMs(histStart, false)).toISOString();
  const toIso     = new Date(shopDayBoundaryMs(to,        true )).toISOString();

  const [rows, products] = await Promise.all([
    loadItemsForWindow(fromIso, toIso),
    listProducts(),
  ]);
  const idx = buildIndex(products);

  // Focal-window rows only.
  const focalStart = shopDayBoundaryMs(from, false);
  const focalEnd   = shopDayBoundaryMs(to,   true);
  const focalRows  = rows.filter((r) => {
    const t = r.orders ? Date.parse(r.orders.order_date) : NaN;
    return t >= focalStart && t <= focalEnd;
  });

  // Aggregate by (groupCode, productCode-or-displayName).
  //   - Item key is the catalog product code when known, so two spellings
  //     of "Hen" collapse into one row.
  //   - Unknown legacy items key on the normalized display name so they
  //     at least don't multi-bucket within "Other".
  interface ItemAgg {
    key:           string;
    display_name:  string;
    group_code:    string;
    group_name:    string;
    group_color:   string;
    product_code:  string | null;
    revenue:       number;
    quantity:      number;
    order_ids:     Set<string>;
  }
  const itemsAgg = new Map<string, ItemAgg>();

  for (const r of focalRows) {
    const bucket = bucketFor(r, idx);
    let key:     string;
    let display: string;
    let gCode:   string;
    let gName:   string;
    let gColor:  string;
    let pCode:   string | null;

    if (bucket) {
      pCode  = bucket.productCode;
      gCode  = bucket.groupCode;
      const gm = idx.groupMeta.get(gCode);
      gName  = gm?.name  ?? gCode;
      gColor = gm?.color ?? OTHER_COLOR;
      // Service-fee lines share the base product's row so the breakdown
      // doesn't sprout a separate "fee" item — fees count as revenue
      // attributed to the same product.
      const baseProduct = pCode ? idx.byCode.get(pCode) : null;
      display = baseProduct?.name ?? r.item_name.trim();
      key     = `code:${pCode}`;
    } else {
      pCode   = null;
      gCode   = OTHER_KEY;
      gName   = OTHER_NAME;
      gColor  = OTHER_COLOR;
      display = r.item_name.trim() || 'Unknown';
      key     = `legacy:${display.toLowerCase()}`;
    }

    let agg = itemsAgg.get(key);
    if (!agg) {
      agg = {
        key, display_name: display,
        group_code: gCode, group_name: gName, group_color: gColor,
        product_code: pCode,
        revenue: 0, quantity: 0,
        order_ids: new Set<string>(),
      };
      itemsAgg.set(key, agg);
    }
    agg.revenue  += Number(r.line_total ?? 0);
    agg.quantity += Number(r.quantity ?? 0);
    agg.order_ids.add(r.order_id);
  }

  // Roll up to category rows (one per group). Keeping the field names
  // (`category_*`) for backwards-compat with the report's existing
  // ReportData consumers — semantically these are product groups now.
  const groupAgg = new Map<string, ReportCategoryRow>();
  for (const it of itemsAgg.values()) {
    const id = it.group_code === OTHER_KEY ? null : it.group_code;
    const existing = groupAgg.get(it.group_code) ?? {
      id, name: it.group_name, color: it.group_color,
      revenue: 0, quantity: 0, item_count: 0,
    };
    existing.revenue    += it.revenue;
    existing.quantity   += it.quantity;
    existing.item_count += 1;
    groupAgg.set(it.group_code, existing);
  }

  const categories: ReportCategoryRow[] = [...groupAgg.values()]
    .map((c) => ({ ...c, revenue: round2(c.revenue), quantity: round3(c.quantity) }))
    .sort((a, b) => {
      // "Other" sinks to the end, real groups by their catalog sort_order.
      if (a.id === null) return  1;
      if (b.id === null) return -1;
      const ai = idx.groupMeta.get(a.id)?.sort ?? 999;
      const bi = idx.groupMeta.get(b.id)?.sort ?? 999;
      return ai - bi || a.name.localeCompare(b.name);
    });

  const items: ReportItemRow[] = [...itemsAgg.values()]
    .map((it) => ({
      display_name:    it.display_name,
      normalized_name: it.key,
      category_id:     it.group_code === OTHER_KEY ? null : it.group_code,
      category_name:   it.group_name,
      category_color:  it.group_color,
      revenue:         round2(it.revenue),
      quantity:        round3(it.quantity),
      order_count:     it.order_ids.size,
      merged_from:     [],  // no fuzzy-merging anymore
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Headline KPIs.
  const total_revenue = round2(items.reduce((s, r) => s + r.revenue, 0));
  const total_items   = round3(items.reduce((s, r) => s + r.quantity, 0));
  const total_orders  = new Set(focalRows.map((r) => r.order_id)).size;

  // Daily totals across the focal window — drives the range bar chart.
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
  const prevTo    = shopShiftYMD(from, -1);
  const prevFrom  = shopShiftYMD(from, -focalDays);
  const prevStart = shopDayBoundaryMs(prevFrom, false);
  const prevEnd   = shopDayBoundaryMs(prevTo,   true);
  const prevRows  = rows.filter((r) => {
    const t = r.orders ? Date.parse(r.orders.order_date) : NaN;
    return t >= prevStart && t <= prevEnd;
  });
  const prev_revenue = round2(prevRows.reduce((s, r) => s + Number(r.line_total ?? 0), 0));
  const prev_orders  = new Set(prevRows.map((r) => r.order_id)).size;
  const prev_label   = isSingleDay
    ? 'vs yesterday'
    : `vs prior ${focalDays === 1 ? 'day' : `${focalDays} days`}`;

  // Per-item sparkline trend — only single-day mode. Bucket each prior
  // day's items the same way the focal window does, then sum into the
  // matching item key.
  const trend_dates: string[] = [];
  const trend_by_item: ReportData['trend_by_item'] = [];
  if (isSingleDay) {
    for (let i = TREND_DAYS - 1; i >= 0; i--) trend_dates.push(shopShiftYMD(from, -i));
    for (const top of items.slice(0, TREND_TOP_N)) {
      const daily_revenue = trend_dates.map((d) => {
        const s = shopDayBoundaryMs(d, false);
        const e = shopDayBoundaryMs(d, true);
        let sum = 0;
        for (const r of rows) {
          if (!r.orders) continue;
          const t = Date.parse(r.orders.order_date);
          if (t < s || t > e) continue;
          const bucket = bucketFor(r, idx);
          const key = bucket
            ? `code:${bucket.productCode}`
            : `legacy:${(r.item_name || '').trim().toLowerCase()}`;
          if (key === top.normalized_name) sum += Number(r.line_total ?? 0);
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
    // Fields kept on ReportData for back-compat with the CSV / XLSX
    // exporters; always empty / zero now that bucketing is exact.
    merges: [],
    uncategorized_count: items.filter((i) => i.category_id === null).length,
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
