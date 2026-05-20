// lib/categories.ts — Normalize item names and bucket them into categories.
//
// Why this file exists:
//   `order_items.item_name` is free text. Staff type "Chicken", "chicken",
//   " CHICKEN ", and occasionally "chiken". Reports that GROUP BY raw
//   item_name would show those as four separate rows. This module:
//
//     1. Normalizes the text (lowercase, trim, collapse whitespace,
//        strip stray punctuation).
//     2. Maps the normalized form to a category via `category_aliases`.
//        Tries exact match first, then bounded fuzzy (Levenshtein ≤ 1)
//        as a fallback so "chiken" finds the "chicken" alias.
//     3. Merges near-spelling items into a single bucket using the same
//        fuzzy threshold, so "kebab" and "kebob" report as one row.
//
// We deliberately keep this in app code (not SQL) so we don't have to
// require the pg_trgm extension and so admins can iterate on the logic
// without writing migrations.

import type { CategoryWithAliases } from '@/types';

// ─────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────

// Strip everything except letters, digits, and spaces; collapse runs of
// whitespace; lowercase; trim. Anchored at unicode letters so accented
// names ("café") survive. We also drop the trailing "(s)" plural so
// "egg" and "eggs" still merge via Levenshtein.
export function normalizeItemName(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Bounded Levenshtein (≤ 1 edit) — used for typo-tolerant matching.
// ─────────────────────────────────────────────────────────────
//
// Standard one-edit check: returns true iff `a` and `b` differ by at
// most one insertion, deletion, or substitution. Linear in the length
// of the shorter string. Faster than full DP because we short-circuit
// as soon as a second discrepancy appears.
//
// Important safety rule: callers should additionally require both
// strings to be at least 4 chars before treating distance-1 as "same
// thing." Otherwise "goat" and "boat" merge — false positive.
export function levenshteinAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Ensure `a` is the shorter (or equal-length) string.
  if (a.length > b.length) { const t = a; a = b; b = t; }

  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length) return true; // identical prefix, b is longer by ≤1

  if (a.length === b.length) {
    // Substitution: skip one char on each side, rest must match.
    let j = i + 1;
    while (j < a.length && a[j] === b[j]) j++;
    return j === a.length;
  } else {
    // Insertion in b: skip one in b, rest must match in lockstep.
    let ai = i, bi = i + 1;
    while (ai < a.length && a[ai] === b[bi]) { ai++; bi++; }
    return ai === a.length;
  }
}

// Heuristic gate for typo merging: only treat distance-1 as "same item"
// when both strings are long enough (>= 4 chars) AND share the first
// two characters. This prevents "goat" ↔ "boat" and "pork" ↔ "park"
// from merging while still catching "chiken" ↔ "chicken" and
// "kebab" ↔ "kebob".
const TYPO_MIN_LEN = 4;
export function looksLikeSameSpelling(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < TYPO_MIN_LEN || b.length < TYPO_MIN_LEN) return false;
  if (a[0] !== b[0] || a[1] !== b[1]) return false;
  return levenshteinAtMost1(a, b);
}

// ─────────────────────────────────────────────────────────────
// Category index — loaded once per request and reused for matching.
// ─────────────────────────────────────────────────────────────

export interface CategoryIndex {
  // category_id → category
  byId: Map<string, CategoryWithAliases>;
  // exact normalized alias → category_id (the hot path)
  aliasExact: Map<string, string>;
  // All aliases with their category_id, for the fuzzy fallback.
  aliasList: Array<{ alias: string; category_id: string }>;
  // All categories sorted by sort_order, for display.
  ordered: CategoryWithAliases[];
}

export function buildCategoryIndex(categories: CategoryWithAliases[]): CategoryIndex {
  const byId = new Map<string, CategoryWithAliases>();
  const aliasExact = new Map<string, string>();
  const aliasList: Array<{ alias: string; category_id: string }> = [];

  for (const c of categories) {
    byId.set(c.id, c);
    for (const a of c.aliases) {
      // Defensive: re-normalize in case stored value drifted.
      const key = normalizeItemName(a.alias_normalized || a.alias);
      if (!key) continue;
      // First-write wins; UNIQUE index on alias_normalized at DB level
      // means this collision can only happen if normalization rules
      // changed between the DB write and now.
      if (!aliasExact.has(key)) aliasExact.set(key, c.id);
      aliasList.push({ alias: key, category_id: c.id });
    }
  }

  const ordered = [...categories].sort((a, b) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  return { byId, aliasExact, aliasList, ordered };
}

// Match a single (already-normalized) item name to a category.
//
// Lookup order:
//   1. Exact alias hit (the common case).
//   2. The item name CONTAINS a known alias as a whole word.
//      e.g. "goat head curry" → matches "goat head" → Goat.
//      Longest match wins so "goat head" beats "goat".
//   3. Fuzzy alias hit (Levenshtein 1, with the length+prefix guard).
//      Catches "chiken" → "chicken".
//
// Returns null if no match. The report then groups the item into the
// "Uncategorized" bucket, where the admin can click to convert the
// item's normalized name into a new alias.
export function matchCategory(
  normalized: string,
  idx: CategoryIndex,
): string | null {
  if (!normalized) return null;

  // 1. Exact
  const exact = idx.aliasExact.get(normalized);
  if (exact) return exact;

  // 2. Contains — longest alias first, word-boundary aware
  let bestLen = 0;
  let bestId: string | null = null;
  // Pad with spaces so word-boundary checks are simple.
  const padded = ' ' + normalized + ' ';
  for (const { alias, category_id } of idx.aliasList) {
    if (alias.length <= bestLen) continue;
    if (padded.includes(' ' + alias + ' ')) {
      bestLen = alias.length;
      bestId  = category_id;
    }
  }
  if (bestId) return bestId;

  // 3. Fuzzy
  for (const { alias, category_id } of idx.aliasList) {
    if (looksLikeSameSpelling(normalized, alias)) return category_id;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Bucket merging — runs after we've grouped by normalized name to
// collapse near-spellings (e.g. "kebab" + "kebob") into the bucket
// with the higher revenue. This is what powers the "possibly the
// same item?" panel on the report.
// ─────────────────────────────────────────────────────────────

export interface RawBucket {
  normalized_name: string;
  display_name: string;     // most-frequent original spelling seen
  category_id: string | null;
  revenue: number;
  quantity: number;
  order_ids: Set<string>;
  // Original spellings + the order-count we saw for each. Used to pick
  // a sensible display name AFTER merging.
  spellings: Map<string, number>;
}

export function mergeFuzzyBuckets(buckets: RawBucket[]): {
  merged: RawBucket[];
  // Buckets that were absorbed into another, for the "possibly same" UI.
  merges: Array<{ kept: string; absorbed: string }>;
} {
  // Sort by revenue desc so the highest-revenue spelling wins as the
  // "kept" bucket. Iterate, comparing each smaller bucket against the
  // already-kept ones.
  const sorted = [...buckets].sort((a, b) => b.revenue - a.revenue);
  const kept: RawBucket[] = [];
  const merges: Array<{ kept: string; absorbed: string }> = [];

  for (const b of sorted) {
    let mergedInto: RawBucket | null = null;
    for (const k of kept) {
      // Only merge within the same category (or both uncategorized).
      // Cross-category fuzzy merges would silently move sales between
      // categories — surprising and hard to debug.
      if ((k.category_id ?? null) !== (b.category_id ?? null)) continue;
      if (looksLikeSameSpelling(k.normalized_name, b.normalized_name)) {
        mergedInto = k;
        break;
      }
    }
    if (mergedInto) {
      mergedInto.revenue  += b.revenue;
      mergedInto.quantity += b.quantity;
      for (const oid of b.order_ids) mergedInto.order_ids.add(oid);
      for (const [sp, n] of b.spellings) {
        mergedInto.spellings.set(sp, (mergedInto.spellings.get(sp) ?? 0) + n);
      }
      merges.push({ kept: mergedInto.display_name, absorbed: b.display_name });
    } else {
      kept.push(b);
    }
  }

  // After merging, re-pick display_name = most-frequent original spelling.
  for (const k of kept) {
    let best = ''; let bestN = -1;
    for (const [sp, n] of k.spellings) {
      if (n > bestN) { best = sp; bestN = n; }
    }
    if (best) k.display_name = best;
  }

  return { merged: kept, merges };
}
