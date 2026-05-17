// lib/date-range.ts — Shop-timezone-aware date range parsing for exports.
import { SHOP_TIMEZONE, shopDayBoundaryMs } from './utils';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedRange {
  fromIso:    string;   // UTC ISO at 00:00:00 SHOP_TIMEZONE of `from`
  toIso:      string;   // UTC ISO at 23:59:59.999 SHOP_TIMEZONE of `to`
  fromLabel:  string;   // 'YYYY-MM-DD' as the caller typed it (for filenames)
  toLabel:    string;
}

export class DateRangeError extends Error {
  status = 400;
  publicMessage: string;
  constructor(msg: string) { super(msg); this.publicMessage = msg; }
}

/**
 * Parse + validate a from/to range against the constraints from the export
 * spec: both YYYY-MM-DD, from <= to, range <= 366 days, both within last
 * 5 years. Throws a DateRangeError with a human message on any violation.
 */
export function parseDateRange(fromRaw: string | null, toRaw: string | null): ParsedRange {
  if (!fromRaw || !toRaw) {
    throw new DateRangeError('Both "from" and "to" dates are required (YYYY-MM-DD).');
  }
  if (!YYYY_MM_DD.test(fromRaw) || !YYYY_MM_DD.test(toRaw)) {
    throw new DateRangeError('Dates must be in YYYY-MM-DD format.');
  }

  const fromMs = shopDayBoundaryMs(fromRaw, false);
  const toMs   = shopDayBoundaryMs(toRaw, true);

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new DateRangeError('Could not parse one of the dates.');
  }
  if (fromMs > toMs) {
    throw new DateRangeError('"from" must be on or before "to".');
  }
  const days = (toMs - fromMs) / 86_400_000;
  if (days > 366) {
    throw new DateRangeError('Range is too large — pick 366 days or fewer.');
  }
  // Both ends within the last 5 years (give a small future buffer for clock skew).
  const FIVE_YEARS = 5 * 366 * 86_400_000;
  const now = Date.now();
  if (now - fromMs > FIVE_YEARS) throw new DateRangeError('"from" cannot be more than 5 years ago.');
  if (toMs - now > 86_400_000)   throw new DateRangeError('"to" cannot be in the future.');

  return {
    fromIso:   new Date(fromMs).toISOString(),
    toIso:     new Date(toMs).toISOString(),
    fromLabel: fromRaw,
    toLabel:   toRaw,
  };
}

/** Default range for the export UI: last 30 days ending today (shop TZ). */
export function defaultRange(): { from: string; to: string } {
  const now = new Date();
  // Use Intl to get today's YYYY-MM-DD in shop TZ
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = fmt.format(now);
  const past  = fmt.format(new Date(now.getTime() - 29 * 86_400_000));
  return { from: past, to: today };
}
