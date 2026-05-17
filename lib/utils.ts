// lib/utils.ts — Shared utility functions

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/**
 * Shop's local timezone for displaying timestamps. Defaults to America/Chicago
 * for Chaudhary Farm (Texas). Read from NEXT_PUBLIC_SHOP_TIMEZONE so it's
 * identical on server and client and there's no SSR/CSR drift.
 */
export const SHOP_TIMEZONE = process.env.NEXT_PUBLIC_SHOP_TIMEZONE || 'America/Chicago';

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  const d    = new Date(dateString);
  const date = d.toLocaleDateString('en-US', { timeZone: SHOP_TIMEZONE, year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: SHOP_TIMEZONE, hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Returns the UTC millis for either 00:00:00 (start) or 23:59:59.999 (end)
 * of the given YYYY-MM-DD calendar day, interpreted in SHOP_TIMEZONE.
 * Handles DST correctly because we query Intl for the offset on that exact day. */
export function shopDayBoundaryMs(yyyymmdd: string, endOfDay: boolean): number {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const probeUtc = Date.UTC(y, m - 1, d, 12);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIMEZONE, timeZoneName: 'longOffset',
  }).formatToParts(new Date(probeUtc));
  const offsetStr = fmt.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const off = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(offsetStr);
  let offsetMin = 0;
  if (off) {
    const h = parseInt(off[1], 10);
    const mm = parseInt(off[2] ?? '0', 10);
    offsetMin = h * 60 + (h < 0 ? -mm : mm);
  }
  const hourMs = endOfDay ? (23 * 3600 + 59 * 60 + 59) * 1000 + 999 : 0;
  return Date.UTC(y, m - 1, d) + hourMs - offsetMin * 60_000;
}

/** Shop-local YYYY-MM-DD for an instant. */
export function shopYMD(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}

/** Shifts a shop-TZ YYYY-MM-DD by N calendar days (positive or negative). */
export function shopShiftYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  // noon UTC of (target day) — safely inside the shop day after the shift.
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000 + 12 * 3600 * 1000;
  return shopYMD(new Date(t));
}

/**
 * Shop-TZ-aware ranges for today, yesterday, this-week (Mon→Sun), this-month.
 * `fromIso`/`toIso` are UTC ISO strings, ready to feed to `order_date >= … and <= …`.
 */
export function shopRanges(now: Date = new Date()): {
  today:     { fromIso: string; toIso: string };
  yesterday: { fromIso: string; toIso: string };
  this_week: { fromIso: string; toIso: string };
  this_month:{ fromIso: string; toIso: string };
} {
  const today = shopYMD(now);

  // Day-of-week for the shop-local date (Mon=0..Sun=6).
  // Use noon UTC of the shop date, then Intl's weekday.
  const [y, m, d] = today.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: SHOP_TIMEZONE, weekday: 'short' }).format(probe);
  const dowIdx = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(weekday);
  const daysBackToMon = dowIdx >= 0 ? dowIdx : 0;
  const monday = shopShiftYMD(today, -daysBackToMon);
  const sunday = shopShiftYMD(monday, 6);

  const monthStart = `${today.slice(0, 7)}-01`;
  // Last day of month: jump forward into next month then back 1 day.
  const [yy, mm] = monthStart.split('-').map(Number);
  const nextMonth = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
  const monthEnd = shopShiftYMD(nextMonth, -1);

  const yesterday = shopShiftYMD(today, -1);

  const iso = (ms: number) => new Date(ms).toISOString();

  return {
    today:     { fromIso: iso(shopDayBoundaryMs(today, false)),     toIso: iso(shopDayBoundaryMs(today, true)) },
    yesterday: { fromIso: iso(shopDayBoundaryMs(yesterday, false)), toIso: iso(shopDayBoundaryMs(yesterday, true)) },
    this_week: { fromIso: iso(shopDayBoundaryMs(monday, false)),    toIso: iso(shopDayBoundaryMs(sunday, true)) },
    this_month:{ fromIso: iso(shopDayBoundaryMs(monthStart, false)),toIso: iso(shopDayBoundaryMs(monthEnd, true)) },
  };
}

/** Returns the start-of-day ISO timestamp in SHOP_TIMEZONE for the date that
 * contains `instant`. Kept for back-compat with existing callers. */
export function shopDayStart(instant: Date = new Date()): Date {
  // Render the instant as YYYY-MM-DD in the shop timezone, then re-parse that
  // calendar date as midnight in the shop timezone using a known offset trick.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant); // YYYY-MM-DD
  // Find the shop-local offset for that midnight by formatting it back.
  const dayStartUtc = new Date(`${parts}T00:00:00Z`);
  const tzOffsetMin = (() => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: SHOP_TIMEZONE, timeZoneName: 'shortOffset' }).format(dayStartUtc);
    const m   = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(fmt);
    if (!m) return 0;
    const h = parseInt(m[1], 10); const mm = parseInt(m[2] ?? '0', 10);
    return h * 60 + (h < 0 ? -mm : mm);
  })();
  return new Date(dayStartUtc.getTime() - tzOffsetMin * 60_000);
}

export function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0].toUpperCase()).join('');
}

export function titleCase(s: unknown): string {
  return String(s || '').trim()
    .replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Build a SQL ILIKE wildcard pattern from raw digits so that a digit-only
 * phone search matches any stored format: (940) 299-5339, 940-299-5339, etc.
 * Splits at US phone boundaries (pos 3, pos 6) so separators in stored values
 * don't break the match.
 */
export function digitSearchPattern(digits: string): string | null {
  const d = digits.replace(/\D/g, '');
  if (d.length < 3)   return null;
  if (d.length === 3)  return `%${d}%`;
  if (d.length <= 6)   return `%${d.slice(0, 3)}%${d.slice(3)}%`;
  return `%${d.slice(0, 3)}%${d.slice(3, 6)}%${d.slice(6)}%`;
}

export function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return phone;
}
