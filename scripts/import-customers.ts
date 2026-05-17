#!/usr/bin/env npx ts-node
// ============================================================
// scripts/import-customers.ts
//
// Imports customers from an Excel (.xlsx) or CSV file into Supabase.
//
// Usage:
//   npx ts-node scripts/import-customers.ts ./customers.xlsx
//   npx ts-node scripts/import-customers.ts ./customers.csv
//
// Expected columns (order doesn't matter, case-insensitive):
//   full_name | name | first_name + last_name
//   phone | phone_number
//   street | address
//   city
//   zip | zip_code | postal_code
//
// What it does:
//   1. Reads the file
//   2. Normalizes phone numbers and addresses
//   3. Deduplicates by phone number, then by name+address
//   4. Generates CUST-XXXX numbers via DB sequence
//   5. Bulk-inserts into Supabase (skips existing phones)
// ============================================================

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

// ── Config ───────────────────────────────────────────────────
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BATCH_SIZE        = 50; // rows per Supabase insert batch

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ──────────────────────────────────────────────────

/** Normalize a phone number → "(XXX) XXX-XXXX" or null */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10)
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1')
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return String(raw).trim() || null; // Return as-is if format unknown
}

/** Title-case a string (handles "JOHN DOE" → "John Doe") */
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Find a column value case-insensitively from a row object */
function col(row: Record<string, unknown>, ...keys: string[]): string {
  const rowLower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v])
  );
  for (const key of keys) {
    const val = rowLower[key.toLowerCase()];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

interface RawRow {
  full_name: string;
  phone_number: string | null;
  street: string;
  city: string;
  zip_code: string;
}

/** Parse the Excel/CSV file into normalized rows */
function parseFile(filePath: string): RawRow[] {
  const workbook = XLSX.readFile(filePath, { type: 'file', cellText: true, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  console.log(`📄  Read ${rows.length} rows from ${path.basename(filePath)}`);

  return rows.map((row): RawRow => {
    // Support "first_name" + "last_name" columns OR "full_name" / "name"
    const firstName = col(row, 'first_name', 'firstname');
    const lastName  = col(row, 'last_name', 'lastname');
    let fullName    = col(row, 'full_name', 'name', 'customer_name', 'fullname');
    if (!fullName && (firstName || lastName)) fullName = `${firstName} ${lastName}`.trim();

    return {
      full_name:    titleCase(fullName),
      phone_number: normalizePhone(col(row, 'phone', 'phone_number', 'telephone', 'cell', 'mobile')),
      street:       titleCase(col(row, 'street', 'address', 'address1', 'street_address')),
      city:         titleCase(col(row, 'city', 'town')),
      zip_code:     col(row, 'zip', 'zip_code', 'postal_code', 'zipcode'),
    };
  }).filter(r => r.full_name); // Drop empty rows
}

/** Deduplicate: prefer phone match, then name+city match */
function deduplicate(rows: RawRow[]): RawRow[] {
  const seenPhone = new Set<string>();
  const seenNameCity = new Set<string>();
  const result: RawRow[] = [];
  let dupeCount = 0;

  for (const row of rows) {
    const phoneKey    = row.phone_number ?? '';
    const nameCityKey = `${row.full_name.toLowerCase()}|${row.city.toLowerCase()}`;

    if (phoneKey && seenPhone.has(phoneKey)) { dupeCount++; continue; }
    if (seenNameCity.has(nameCityKey))        { dupeCount++; continue; }

    if (phoneKey) seenPhone.add(phoneKey);
    seenNameCity.add(nameCityKey);
    result.push(row);
  }

  console.log(`🔍  Removed ${dupeCount} duplicates → ${result.length} unique customers`);
  return result;
}

/** Get existing phones from Supabase to avoid re-importing */
async function getExistingPhones(): Promise<Set<string>> {
  const { data } = await supabase.from('customers').select('phone_number');
  return new Set((data ?? []).map(c => c.phone_number).filter(Boolean) as string[]);
}

/** Insert customers in batches using the DB sequence for CUST numbers */
async function insertBatch(rows: RawRow[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Get customer numbers for this batch from the DB sequence
    const customerNumbers: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const { data } = await supabase.rpc('get_next_customer_number');
      customerNumbers.push(data as string);
    }

    const records = batch.map((row, idx) => ({
      customer_number: customerNumbers[idx],
      full_name:       row.full_name,
      phone_number:    row.phone_number,
      street:          row.street || null,
      city:            row.city   || null,
      zip_code:        row.zip_code || null,
      points_balance:  0,
    }));

    const { error, data } = await supabase.from('customers').insert(records).select('id');
    if (error) {
      console.error(`  ⚠️  Batch error: ${error.message}`);
    } else {
      inserted += data?.length ?? 0;
      console.log(`  ✅  Inserted batch ${Math.floor(i/BATCH_SIZE)+1}: ${data?.length} customers`);
    }
  }

  return inserted;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx ts-node scripts/import-customers.ts <path-to-file.xlsx|csv>');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`❌  File not found: ${filePath}`);
    process.exit(1);
  }

  console.log('\n🥩  Prime Cut — Customer Import Tool\n');

  // 1. Parse
  const parsed = parseFile(filePath);

  // 2. Deduplicate within file
  const unique = deduplicate(parsed);

  // 3. Skip phones already in DB
  const existingPhones = await getExistingPhones();
  const newRows = unique.filter(
    r => !r.phone_number || !existingPhones.has(r.phone_number)
  );
  console.log(`📊  ${unique.length - newRows.length} already in DB → importing ${newRows.length} new customers`);

  if (newRows.length === 0) {
    console.log('✅  Nothing to import.');
    return;
  }

  // 4. Insert
  const inserted = await insertBatch(newRows);
  console.log(`\n✅  Import complete! Inserted ${inserted} customers.\n`);
}

main().catch((err) => {
  console.error('❌  Fatal error:', err);
  process.exit(1);
});
