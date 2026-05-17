// lib/retention-types.ts — Client-safe types and constants for retention.
// Kept separate from lib/retention.ts so client components can import without
// pulling in next/headers and the supabase server client.

export type RetentionBucket = 'slipping' | 'cold' | 'one_time';

export interface RetentionSettings {
  cold_days:                number;
  one_time_days:            number;
  slipping_avg_gap_cap:     number;
  slipping_multiplier:      number;
  contacted_suppress_days:  number;
}

export const DEFAULT_SETTINGS: RetentionSettings = {
  cold_days: 40,
  one_time_days: 30,
  slipping_avg_gap_cap: 25,
  slipping_multiplier: 1.75,
  contacted_suppress_days: 14,
};

import type { Customer } from '@/types';

export interface RetentionCustomer {
  customer: Customer;
  bucket: RetentionBucket;
  last_order_at: string | null;
  first_order_at: string | null;
  order_count: number;
  days_since_last: number;
  // Median of the gaps between consecutive orders, in days. Was previously
  // a uniform "(total span) / (n-1)" average, which lied about cadence for
  // customers with bursty patterns (e.g. day 1, day 2, day 100 → reported
  // as "every 50 days" but the true gaps were 1 and 98).
  median_gap_days: number | null;
  last_contacted_at: string | null;
}

export interface RetentionResult {
  slipping:  RetentionCustomer[];
  cold:      RetentionCustomer[];
  one_time:  RetentionCustomer[];
  total:     number;
  settings:  RetentionSettings;
}
