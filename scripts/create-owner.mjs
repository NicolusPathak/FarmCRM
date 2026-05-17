// scripts/create-owner.mjs
// One-time setup for the "Hero Go" owner account. Run with:
//
//   npm run create-owner
//
// Prompts for a username + password on the terminal, bcrypts the password,
// and inserts or replaces the single owner_credentials row.
//
// Re-running this overwrites the existing credentials. The plaintext password
// is NEVER persisted — only the bcrypt hash is written to the DB.
//
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { Writable } from 'stream';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

// ── Load .env.local ──────────────────────────────────────────
// fileURLToPath decodes %20 etc. — using URL.pathname directly breaks when
// the project folder contains a space (e.g. "meat-shop 2").
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

// ── Prompt helpers ───────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

// Hide what the user is typing — useful for passwords. Uses a muted Writable
// that ignores anything readline tries to echo after the prompt is written.
function promptSecret(question) {
  return new Promise((resolve) => {
    const muted = new Writable({
      write(chunk, _enc, cb) {
        // Allow only the very first emission (the prompt itself); silence the rest.
        if (!muted._promptWritten) {
          process.stdout.write(chunk);
          muted._promptWritten = true;
        }
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

// ── Password rules ───────────────────────────────────────────

function validatePassword(pw) {
  if (pw.length < 12) return 'Password must be at least 12 characters.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must include at least one letter.';
  if (!/\d/.test(pw)) return 'Password must include at least one digit.';
  return null;
}

// ── Main ─────────────────────────────────────────────────────

console.log('\n🦸  Hero Go — owner account setup\n');

// Check if an owner already exists (informational).
const { data: existing } = await sb
  .from('owner_credentials')
  .select('id, username, created_at, last_login_at, session_version');
if (existing && existing.length > 0) {
  console.log('⚠️   An owner account already exists:');
  for (const row of existing) {
    console.log(`    · ${row.username}   (created ${row.created_at}, last login ${row.last_login_at ?? 'never'})`);
  }
  console.log('     Re-running this script will overwrite the password of a matching username,');
  console.log('     or create a new credential row if you choose a different username.\n');
}

const username = (await prompt('Username: ')).trim();
if (!username) {
  console.error('Username is required.');
  process.exit(1);
}

const password = await promptSecret('Password (input hidden): ');
const confirm  = await promptSecret('Confirm password:        ');
if (password !== confirm) {
  console.error('Passwords do not match.');
  process.exit(1);
}

const rule = validatePassword(password);
if (rule) {
  console.error(rule);
  process.exit(1);
}

console.log('\n🔐  Hashing password…');
const password_hash = await bcrypt.hash(password, 12);

// If we're overwriting an existing username, bump session_version so any
// browser cookie that was issued under the OLD password becomes invalid
// immediately. New rows start at 0; updates increment by 1.
const existingRow = (existing ?? []).find((r) => r.username === username);
const session_version = existingRow ? (existingRow.session_version ?? 0) + 1 : 0;

const { error } = await sb
  .from('owner_credentials')
  .upsert({ username, password_hash, session_version } /* @ts-ignore */, { onConflict: 'username' });

if (error) {
  console.error('Failed to save owner:', error.message);
  process.exit(1);
}

console.log('✅  Owner saved.\n');
console.log('You can now sign in via the "Hero Go" button on the login page.');
console.log('To overwrite this password later, re-run `npm run create-owner`.');
