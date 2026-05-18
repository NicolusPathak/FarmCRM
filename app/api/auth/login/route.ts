// app/api/auth/login/route.ts — 4-digit PIN login with brute-force lockout.
// After 3 failed attempts from the same IP in a 15-minute window,
// further attempts return 429 until the oldest failure ages out.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import { SESSION_COOKIE, SESSION_MAX_AGE, hashPin, signSession } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request-ip';

const PIN_RE = /^\d{4}$/;
const MAX_FAILS = 3;
const WINDOW_MIN = 15;

export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({}));
  const raw = typeof pin === 'string' ? pin.trim() : '';

  if (!PIN_RE.test(raw)) {
    return NextResponse.json({ error: 'Enter your 4-digit PIN.' }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const ip = clientIp(req);
  const windowStart = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  // Opportunistic cleanup — fire-and-forget delete of rows older than the window
  // so the table never grows unbounded. Doesn't affect this request's logic.
  sb.from('login_attempts').delete().lt('failed_at', windowStart).then(() => {}, () => {});

  // Check current failed-attempt count
  const { count: fails } = await sb
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('failed_at', windowStart);

  if ((fails ?? 0) >= MAX_FAILS) {
    return NextResponse.json(
      { error: `Too many wrong PINs. Try again in ${WINDOW_MIN} minutes.` },
      { status: 429 },
    );
  }

  const pin_hash = await hashPin(raw);
  const { data: match } = await sb
    .from('staff_users')
    .select('id, name, role, active, archived_at, session_version')
    .eq('pin_hash', pin_hash)
    .is('archived_at', null)
    .maybeSingle();

  const user = match as { id: string; name: string; role: 'admin' | 'staff'; active: boolean; archived_at: string | null; session_version: number } | null;

  if (!user || !user.active) {
    // Record the failed attempt and report remaining tries.
    await sb.from('login_attempts').insert({ ip, failed_at: new Date().toISOString() } as any);
    const remaining = Math.max(0, MAX_FAILS - ((fails ?? 0) + 1));
    return NextResponse.json(
      {
        error: remaining > 0
          ? `Invalid PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : `Too many wrong PINs. Try again in ${WINDOW_MIN} minutes.`,
      },
      { status: 401 },
    );
  }

  // Successful login — wipe failed-attempt rows for this IP.
  await sb.from('login_attempts').delete().eq('ip', ip);

  const sessionUser = { id: user.id, name: user.name, role: user.role };

  // Record the login in audit_log so the activity page shows who came in
  // and from where. Best-effort — login should succeed even if audit fails.
  await logAudit({
    actor: sessionUser,
    action: 'staff_login',
    entity_type: 'staff',
    entity_id: user.id,
    entity_label: user.name,
    changes: { role: user.role, ip },
  });

  const token = await signSession(sessionUser, user.session_version ?? 0);
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
