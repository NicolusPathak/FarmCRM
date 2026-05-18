// scripts/backup.mjs
// ---------------------------------------------------------------------------
// Snapshots the entire customer / order / audit state to a timestamped folder
// of CSVs. Run weekly (or daily) from a cron-equivalent on a machine that has
// .env.local pointing at the production Supabase.
//
//   npm run backup
//
// Output: ./backups/YYYY-MM-DD_HHMMSS/{customers,orders,order_items,audit_log,
//                                     staff_users,owner_credentials,app_settings}.csv
//
// Restore path (documented in BACKUP_RESTORE.md):
//   1. Spin up a fresh Supabase project + apply migrations 01-08 to it.
//   2. Use Supabase CSV-import or `psql \copy` to load each table in
//      dependency order: staff_users → customers → orders → order_items
//      → audit_log → app_settings → owner_credentials.
//   3. Reset sequences: customer_number_seq + order_number_seq to MAX(...) + 1.
//   4. Point .env.local at the new project and run a smoke test.
//
// Why CSV not pg_dump:
//   - Free-tier Supabase doesn't expose the direct postgres host. CSV via
//     the REST API works regardless and produces files anyone with the
//     dashboard can re-import.
//   - These files are also human-readable for audit and disaster forensics.
// ---------------------------------------------------------------------------

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// ── Load .env.local ──────────────────────────────────────────
const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
let SUPABASE_URL = '', SUPABASE_KEY = '';
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    const val = v.join('=').trim();
    if (k?.trim() === 'NEXT_PUBLIC_SUPABASE_URL')  SUPABASE_URL = val;
    if (k?.trim() === 'SUPABASE_SERVICE_ROLE_KEY') SUPABASE_KEY = val;
  }
} catch {
  console.error('Could not read .env.local');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CSV helpers (RFC 4180-compliant; mirrors lib/csv.ts) ─────
const NEEDS_QUOTING = /[",\r\n]/;
function csvField(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = typeof v === 'string' ? v : String(v);
  if (s === '') return '';
  if (NEEDS_QUOTING.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvLine(values) { return values.map(csvField).join(','); }

// ── Pull a table fully (paginated; Supabase caps at 1000/req) ─
async function pullTable(name) {
  const BATCH = 1000;
  let offset  = 0;
  const all = [];
  for (;;) {
    const { data, error } = await sb.from(name)
      .select('*')
      .order('id', { ascending: true })
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(`pull ${name}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return all;
}

function tableToCsv(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const header = csvLine(cols);
  const body = rows.map((r) => csvLine(cols.map((c) => r[c]))).join('\r\n');
  return '﻿' + header + '\r\n' + body + '\r\n'; // UTF-8 BOM for Excel
}

// ── Main ─────────────────────────────────────────────────────
const TABLES = [
  'customers',
  'orders',
  'order_items',
  'audit_log',
  'staff_users',
  'owner_credentials',
  'app_settings',
];

const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
const outDir = fileURLToPath(new URL(`../backups/${ts}`, import.meta.url));
mkdirSync(outDir, { recursive: true });

console.log(`\n🗄️   Snapshot → ${outDir}\n`);

let totalRows = 0;
const summary = [];
for (const t of TABLES) {
  process.stdout.write(`  • ${t.padEnd(22)} `);
  try {
    const rows = await pullTable(t);
    const csv  = tableToCsv(rows);
    writeFileSync(`${outDir}/${t}.csv`, csv);
    console.log(`${rows.length} rows`);
    totalRows += rows.length;
    summary.push({ table: t, rows: rows.length });
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    summary.push({ table: t, rows: -1, error: e.message });
  }
}

// Write a manifest with row counts + timestamp so a restore script can verify.
writeFileSync(`${outDir}/MANIFEST.json`, JSON.stringify({
  taken_at: new Date().toISOString(),
  supabase_url: SUPABASE_URL,
  total_rows: totalRows,
  tables: summary,
}, null, 2) + '\n');

console.log(`\n✅  Backup complete · ${totalRows} rows total · ${outDir}\n`);
console.log('   To verify restorability, occasionally run RESTORE_TEST against this folder.');
