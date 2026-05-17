// scripts/run-import.mjs
// Run with: node scripts/run-import.mjs
// Reads the Excel file and inserts directly into Supabase.
// Requires .env.local to have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// ── Read .env.local manually ─────────────────────────────────
const envPath = new URL('../.env.local', import.meta.url).pathname;
let SUPABASE_URL = '', SUPABASE_KEY = '';
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    const val = v.join('=').trim();
    if (k?.trim() === 'NEXT_PUBLIC_SUPABASE_URL')  SUPABASE_URL = val;
    if (k?.trim() === 'SUPABASE_SERVICE_ROLE_KEY')  SUPABASE_KEY = val;
  }
} catch { console.error('Could not read .env.local'); process.exit(1); }

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ──────────────────────────────────────────────────
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return String(raw || '').trim() || null;
}

function titleCase(s) {
  return String(s || '').trim()
    .replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── Parse Excel ──────────────────────────────────────────────
const FILE = '/mnt/user-data/uploads/CHAUDHARY_FARM_CUSTOMERS_LIST-_04-15-24.xlsx';
console.log('\n🥩  Prime Cut — Customer Import\n');
console.log('📄  Reading:', FILE);

const wb   = XLSX.readFile(FILE);
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
console.log(`    ${rows.length} rows found in spreadsheet`);

// ── Clean & deduplicate ──────────────────────────────────────
const seenPhone = new Set();
const seenName  = new Set();
const clean     = [];
let   skipped   = 0;

for (const r of rows) {
  const name     = titleCase(r['NAME ']);
  const rawPhone = String(r['PHONE NO '] || '').replace(/\D/g, '');
  const phone    = normalizePhone(r['PHONE NO ']);

  if (!name)                              { skipped++; continue; } // empty row
  if (rawPhone && seenPhone.has(rawPhone)){ skipped++; continue; } // dup phone
  if (seenName.has(name.toLowerCase()))   { skipped++; continue; } // dup name

  if (rawPhone) seenPhone.add(rawPhone);
  seenName.add(name.toLowerCase());

  clean.push({
    full_name:    name,
    phone_number: phone,
    street:       titleCase(r['ADDRESS ']) || null,
    city:         titleCase(r['CITY '])    || null,
    zip_code:     String(r['ZIP '] || '').trim() || null,
    points_balance: 0,
  });
}

console.log(`🔍  After dedup: ${clean.length} unique customers (${skipped} skipped)\n`);

// ── Skip phones already in DB ────────────────────────────────
const { data: existing } = await sb.from('customers').select('phone_number');
const existingPhones = new Set((existing || []).map(c => c.phone_number).filter(Boolean));
const toInsert = clean.filter(c => !c.phone_number || !existingPhones.has(c.phone_number));
const alreadyIn = clean.length - toInsert.length;
if (alreadyIn > 0) console.log(`⚠️   ${alreadyIn} already in database — skipping\n`);
console.log(`📥  Inserting ${toInsert.length} new customers...\n`);

if (toInsert.length === 0) {
  console.log('✅  Nothing to import — all customers already in database.\n');
  process.exit(0);
}

// ── Insert in batches ────────────────────────────────────────
const BATCH = 50;
let inserted = 0;
let errors   = 0;

for (let i = 0; i < toInsert.length; i += BATCH) {
  const batch   = toInsert.slice(i, i + BATCH);
  const numbers = [];

  // Get sequential customer numbers from DB function
  for (let j = 0; j < batch.length; j++) {
    const { data } = await sb.rpc('get_next_customer_number');
    numbers.push(data);
  }

  const records = batch.map((c, j) => ({ customer_number: numbers[j], ...c }));
  const { data, error } = await sb.from('customers').insert(records).select('id');

  if (error) {
    console.error(`  ❌ Batch ${Math.floor(i/BATCH)+1} failed:`, error.message);
    errors += batch.length;
  } else {
    inserted += data?.length ?? 0;
    const pct = Math.round(((i + batch.length) / toInsert.length) * 100);
    process.stdout.write(`  ✅ ${inserted} inserted... ${pct}%\r`);
  }
}

console.log(`\n\n🎉  Done! ${inserted} customers imported, ${errors} errors.\n`);
