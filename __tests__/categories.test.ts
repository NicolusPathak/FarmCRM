import { describe, it, expect } from 'vitest';
import {
  normalizeItemName,
  levenshteinAtMost1,
  looksLikeSameSpelling,
  buildCategoryIndex,
  matchCategory,
  mergeFuzzyBuckets,
  type RawBucket,
} from '../lib/categories';
import type { CategoryWithAliases } from '../types';

// ─── normalizeItemName ────────────────────────────────────────
describe('normalizeItemName', () => {
  it('lowercases and trims', () => {
    expect(normalizeItemName('  Chicken  ')).toBe('chicken');
    expect(normalizeItemName('CHICKEN')).toBe('chicken');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeItemName('goat   curry')).toBe('goat curry');
    expect(normalizeItemName('goat\tcurry')).toBe('goat curry');
  });
  it('strips punctuation', () => {
    expect(normalizeItemName('chicken!')).toBe('chicken');
    expect(normalizeItemName('goat, curry')).toBe('goat curry');
    expect(normalizeItemName('(1) goat-head')).toBe('1 goat head');
  });
  it('strips diacritics so "Café" and "Cafe" match', () => {
    expect(normalizeItemName('Café')).toBe('cafe');
    expect(normalizeItemName('CAFE')).toBe('cafe');
  });
  it('returns empty on empty input', () => {
    expect(normalizeItemName('')).toBe('');
    expect(normalizeItemName('   ')).toBe('');
    expect(normalizeItemName('!!!')).toBe('');
  });
});

// ─── levenshteinAtMost1 ───────────────────────────────────────
describe('levenshteinAtMost1', () => {
  it('identical strings match', () => {
    expect(levenshteinAtMost1('chicken', 'chicken')).toBe(true);
  });
  it('catches single insertion', () => {
    expect(levenshteinAtMost1('chiken', 'chicken')).toBe(true);
    expect(levenshteinAtMost1('chicken', 'chiken')).toBe(true);
  });
  it('catches single substitution', () => {
    expect(levenshteinAtMost1('kebab', 'kebob')).toBe(true);
  });
  it('catches single deletion', () => {
    expect(levenshteinAtMost1('chicken', 'chiken')).toBe(true);
  });
  it('rejects two edits', () => {
    expect(levenshteinAtMost1('chicken', 'chkn')).toBe(false);
  });
  it('rejects very different strings', () => {
    expect(levenshteinAtMost1('chicken', 'goat')).toBe(false);
  });
});

// ─── looksLikeSameSpelling — the merge gate ───────────────────
describe('looksLikeSameSpelling', () => {
  it('merges chiken / chicken', () => {
    expect(looksLikeSameSpelling('chiken', 'chicken')).toBe(true);
  });
  it('merges kebab / kebob', () => {
    expect(looksLikeSameSpelling('kebab', 'kebob')).toBe(true);
  });
  it('does NOT merge goat / boat (short + different first chars)', () => {
    expect(looksLikeSameSpelling('goat', 'boat')).toBe(false);
  });
  it('does NOT merge pork / park (different second char)', () => {
    expect(looksLikeSameSpelling('pork', 'park')).toBe(false);
  });
  it('does NOT merge short strings', () => {
    expect(looksLikeSameSpelling('cat', 'cot')).toBe(false);
  });
  it('does NOT merge across categories of similar-but-distinct items', () => {
    // Both 4 chars, share first 2 — but distance 2.
    expect(looksLikeSameSpelling('lamb', 'lard')).toBe(false);
  });
  it('merges goat head / goat heat', () => {
    expect(looksLikeSameSpelling('goat head', 'goat heat')).toBe(true);
  });
});

// ─── matchCategory — the full lookup chain ────────────────────
function makeIdx() {
  const cats: CategoryWithAliases[] = [
    {
      id: 'g', name: 'Goat', color: '#b0322b', sort_order: 10,
      archived_at: null, created_at: '', updated_at: '',
      aliases: [
        { id: '1', category_id: 'g', alias: 'goat',      alias_normalized: 'goat',      created_at: '' },
        { id: '2', category_id: 'g', alias: 'goat head', alias_normalized: 'goat head', created_at: '' },
        { id: '3', category_id: 'g', alias: 'mutton',    alias_normalized: 'mutton',    created_at: '' },
      ],
    },
    {
      id: 'c', name: 'Chicken', color: '#d97706', sort_order: 20,
      archived_at: null, created_at: '', updated_at: '',
      aliases: [
        { id: '4', category_id: 'c', alias: 'chicken', alias_normalized: 'chicken', created_at: '' },
      ],
    },
  ];
  return buildCategoryIndex(cats);
}

describe('matchCategory', () => {
  const idx = makeIdx();
  it('exact match on alias', () => {
    expect(matchCategory('chicken', idx)).toBe('c');
    expect(matchCategory('goat', idx)).toBe('g');
  });
  it('case + whitespace already normalized', () => {
    expect(matchCategory('mutton', idx)).toBe('g');
  });
  it('contains: "goat head curry" matches "goat head" not "goat"', () => {
    expect(matchCategory('goat head curry', idx)).toBe('g');
  });
  it('fuzzy: "chiken" finds chicken', () => {
    expect(matchCategory('chiken', idx)).toBe('c');
  });
  it('unknown items return null', () => {
    expect(matchCategory('fish', idx)).toBe(null);
    expect(matchCategory('', idx)).toBe(null);
  });
});

// ─── mergeFuzzyBuckets — the cross-bucket merger ──────────────
function rb(name: string, revenue: number, category_id: string | null = null): RawBucket {
  return {
    normalized_name: name,
    display_name: name,
    category_id,
    revenue,
    quantity: 1,
    order_ids: new Set(['o1']),
    spellings: new Map([[name, 1]]),
  };
}

describe('mergeFuzzyBuckets', () => {
  it('merges chicken-spellings, keeping the higher-revenue one', () => {
    const { merged, merges } = mergeFuzzyBuckets([
      rb('chicken', 100, 'c'),
      rb('chiken',   30, 'c'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].revenue).toBe(130);
    expect(merged[0].display_name).toBe('chicken'); // higher revenue wins
    expect(merges).toEqual([{ kept: 'chicken', absorbed: 'chiken' }]);
  });
  it('refuses to merge across categories even with similar names', () => {
    // Concocted edge case: same spelling under different categories
    // (shouldn't normally happen, but the safety still holds).
    const { merged, merges } = mergeFuzzyBuckets([
      rb('chicken', 100, 'c'),
      rb('chiken',   30, 'g'), // different category
    ]);
    expect(merged).toHaveLength(2);
    expect(merges).toHaveLength(0);
  });
  it('does not merge unrelated items', () => {
    const { merged, merges } = mergeFuzzyBuckets([
      rb('chicken', 100, 'c'),
      rb('mutton',   50, 'g'),
      rb('egg',      20, 'e'),
    ]);
    expect(merged).toHaveLength(3);
    expect(merges).toHaveLength(0);
  });
});
