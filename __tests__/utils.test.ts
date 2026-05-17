import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatDate,
  getInitials,
  normalizePhone,
  titleCase,
  digitSearchPattern,
} from '../lib/utils';

// ─── formatCurrency ───────────────────────────────────────────
describe('formatCurrency', () => {
  it('formats whole dollars', () => {
    expect(formatCurrency(10)).toBe('$10.00');
  });
  it('formats cents', () => {
    expect(formatCurrency(10.5)).toBe('$10.50');
  });
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
  it('formats large amounts with commas', () => {
    expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
  });
});

// ─── formatDate ───────────────────────────────────────────────
describe('formatDate', () => {
  it('formats an ISO date string', () => {
    // Use a fixed UTC date and check the shape, not locale-specific text
    const result = formatDate('2024-06-15T12:00:00Z');
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/15/);
  });
});

// ─── getInitials ──────────────────────────────────────────────
describe('getInitials', () => {
  it('returns two initials for a full name', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });
  it('returns one initial for a single name', () => {
    expect(getInitials('Alice')).toBe('A');
  });
  it('caps at two initials for longer names', () => {
    expect(getInitials('Mary Jane Watson')).toBe('MJ');
  });
  it('uppercases initials', () => {
    expect(getInitials('john doe')).toBe('JD');
  });
  it('ignores extra whitespace', () => {
    expect(getInitials('  Jane   Smith  ')).toBe('JS');
  });
});

// ─── normalizePhone ───────────────────────────────────────────
describe('normalizePhone', () => {
  it('formats a 10-digit string', () => {
    expect(normalizePhone('9402995339')).toBe('(940) 299-5339');
  });
  it('formats an 11-digit string starting with 1', () => {
    expect(normalizePhone('19402995339')).toBe('(940) 299-5339');
  });
  it('strips dashes before formatting', () => {
    expect(normalizePhone('940-299-5339')).toBe('(940) 299-5339');
  });
  it('strips parentheses and spaces before formatting', () => {
    expect(normalizePhone('(940) 299-5339')).toBe('(940) 299-5339');
  });
  it('returns original string when it cannot be normalized', () => {
    expect(normalizePhone('555')).toBe('555');
  });
  it('returns original string for an empty input', () => {
    expect(normalizePhone('')).toBe('');
  });
});

// ─── titleCase ────────────────────────────────────────────────
describe('titleCase', () => {
  it('capitalises each word', () => {
    expect(titleCase('john doe')).toBe('John Doe');
  });
  it('lowercases the rest of each word', () => {
    expect(titleCase('MARY JANE')).toBe('Mary Jane');
  });
  it('handles mixed case', () => {
    expect(titleCase('mARY jANE')).toBe('Mary Jane');
  });
  it('trims surrounding whitespace', () => {
    expect(titleCase('  alice  ')).toBe('Alice');
  });
  it('returns empty string for empty input', () => {
    expect(titleCase('')).toBe('');
  });
  it('handles null/undefined gracefully', () => {
    expect(titleCase(null)).toBe('');
    expect(titleCase(undefined)).toBe('');
  });
});

// ─── digitSearchPattern ───────────────────────────────────────
// Helper: simulate SQL ILIKE matching so we can assert the pattern
// actually matches a stored phone number value.
function ilike(pattern: string, value: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$',
    'i'
  );
  return regex.test(value);
}

describe('digitSearchPattern', () => {
  it('returns null for fewer than 3 digits', () => {
    expect(digitSearchPattern('94')).toBeNull();
    expect(digitSearchPattern('')).toBeNull();
  });

  it('3 digits → simple wildcard', () => {
    expect(digitSearchPattern('940')).toBe('%940%');
  });

  it('4–6 digits → split at area-code boundary', () => {
    expect(digitSearchPattern('9402')).toBe('%940%2%');
    expect(digitSearchPattern('940299')).toBe('%940%299%');
  });

  it('7–10 digits → split at both boundaries', () => {
    expect(digitSearchPattern('9402995')).toBe('%940%299%5%');
    expect(digitSearchPattern('9402995339')).toBe('%940%299%5339%');
  });

  it('strips non-digits from input before building pattern', () => {
    expect(digitSearchPattern('(940) 299')).toBe('%940%299%');
  });

  // ── Critical: patterns must actually match stored phone formats ──

  it('10-digit input matches "(XXX) XXX-XXXX" stored format', () => {
    const p = digitSearchPattern('9402995339')!;
    expect(ilike(p, '(940) 299-5339')).toBe(true);
  });

  it('10-digit input matches "XXX-XXX-XXXX" stored format', () => {
    const p = digitSearchPattern('9402995339')!;
    expect(ilike(p, '940-299-5339')).toBe(true);
  });

  it('10-digit input matches raw digits stored format', () => {
    const p = digitSearchPattern('9402995339')!;
    expect(ilike(p, '9402995339')).toBe(true);
  });

  it('4-digit input matches stored number with that area-code prefix', () => {
    const p = digitSearchPattern('9402')!;
    expect(ilike(p, '(940) 299-5339')).toBe(true);
  });

  it('4-digit input does NOT match a number with a different area code', () => {
    const p = digitSearchPattern('9402')!;
    expect(ilike(p, '(555) 299-5339')).toBe(false);
  });

  it('3-digit area code matches any number in that area', () => {
    const p = digitSearchPattern('940')!;
    expect(ilike(p, '(940) 299-5339')).toBe(true);
    expect(ilike(p, '(940) 111-2222')).toBe(true);
  });
});
