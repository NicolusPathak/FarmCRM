// app/api/auth/owner-login/route.ts — "Hero Go" username + password login.
// Heavier rate limit than the PIN endpoint because the account is high-value
// and used rarely: 3 failures from the same IP in 60 minutes → 60-min lockout.
// Every attempt (success and failure) is recorded in login_attempts with
// kind='owner' so it can't be mixed up with the PIN-login counter.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request-ip';

const MAX_FAILS = 3;
const WINDOW_MIN = 60;
const KIND = 'owner';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const ip = clientIp(req);
  const windowStart = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  // Opportunistic cleanup
  sb.from('login_attempts')
    .delete()
    .eq('kind', KIND)
    .lt('failed_at', windowStart)
    .then(() => {}, () => {});

  // Lockout check
  const { count: fails } = await sb
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('kind', KIND)
    .eq('ip', ip)
    .gte('failed_at', windowStart);

  if ((fails ?? 0) >= MAX_FAILS) {
    return NextResponse.json(
      { error: `Too many wrong attempts. Try again in ${WINDOW_MIN} minutes.` },
      { status: 429 },
    );
  }

  // Constant-time-ish lookup: always do the bcrypt compare even if no match,
  // so attackers can't distinguish "wrong username" from "wrong password" by timing.
  const { data: row } = await sb
    .from('owner_credentials')
    .select('id, username, password_hash, session_version')
    .eq('username', username)
    .maybeSingle();

  const hashToCheck = (row as any)?.password_hash ?? '$2a$10$invalidhashinvalidhashinvalidhashinvalidhashinvalidha';
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!row || !passwordOk) {
    await sb.from('login_attempts').insert({ ip, kind: KIND, failed_at: new Date().toISOString() } as any);
    const remaining = Math.max(0, MAX_FAILS - ((fails ?? 0) + 1));
    return NextResponse.json(
      {
        error: remaining > 0
          ? `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : `Too many wrong attempts. Try again in ${WINDOW_MIN} minutes.`,
      },
      { status: 401 },
    );
  }

  // Success — wipe failed attempts for this IP, stamp last_login_at, sign session.
  await sb.from('login_attempts').delete().eq('ip', ip).eq('kind', KIND);
  await sb.from('owner_credentials')
    .update({ last_login_at: new Date().toISOString() } as any)
    .eq('id', (row as any).id);

  const sessionUser = {
    id: (row as any).id as string,
    name: (row as any).username as string,
    role: 'owner' as const,
  };

  // Audit loudly — owner logins are rare and worth knowing about.
  await logAudit({
    actor: sessionUser,
    action: 'owner_login',
    entity_type: 'staff',
    entity_id: sessionUser.id,
    entity_label: sessionUser.name,
    changes: { ip },
  });

  const token = await signSession(sessionUser, (row as any).session_version ?? 0);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  return NextResponse.json(sessionUser);
}
