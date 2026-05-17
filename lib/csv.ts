// lib/csv.ts — RFC 4180-compliant CSV escaping for exports.
//
// Behavior:
//   - null / undefined / empty → empty string (NOT the literal "null").
//   - Any field containing comma, double-quote, CR, or LF is wrapped in
//     double quotes; internal double quotes are doubled.
//   - Numbers/booleans are coerced via String().
//   - Dates / ISO strings pass through unchanged — callers format the
//     timestamps themselves (so shop-TZ formatting stays in one place).

const NEEDS_QUOTING = /[",\r\n]/;

// Excel / Google Sheets / LibreOffice treat any cell starting with these
// characters as a formula. A customer name like `=cmd|'/c calc'!A1` would
// auto-execute when the file is opened. Defense-in-depth: prefix dangerous
// leading chars with a single quote so the cell renders as plain text.
// (The leading quote is invisible to the spreadsheet user.)
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

/** Escape a single CSV field. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s === '') return '';
  // Apply formula-injection prefix BEFORE quote-escaping so the apostrophe
  // ends up inside the quoted value when quoting is also needed.
  const safe = FORMULA_LEADERS.test(s) ? `'${s}` : s;
  if (NEEDS_QUOTING.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Build a single CSV line from an array of fields. Terminator NOT included. */
export function csvLine(fields: unknown[]): string {
  return fields.map(csvField).join(',');
}

/** Helpers for building Content-Disposition values safely. */
export function attachmentHeader(filename: string): string {
  // Disallow CR/LF + double quotes in filename to keep header well-formed.
  const safe = filename.replace(/["\r\n]/g, '_');
  return `attachment; filename="${safe}"`;
}
