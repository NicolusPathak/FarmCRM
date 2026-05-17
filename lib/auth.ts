// lib/auth.ts — Server-only session readers and route guards.
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@/types';
import { SESSION_COOKIE, verifySession } from './session';
import { createSupabaseAdminClient } from './supabase-server';

// Validates the cookie (HMAC + expiry) AND confirms the user is still
// active by comparing the version stamped at login time against the
// current `session_version` on the user row. Revoke + PIN reset bump the
// row's version, immediately invalidating every outstanding cookie.
//
// The proxy/middleware still uses the cheap crypto-only `verifySession`
// for routing. Live revocation is enforced here, at the application layer.
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const verified = await verifySession(token);
  if (!verified) return null;

  const sb = createSupabaseAdminClient();

  if (verified.user.role === 'owner') {
    // Owner credentials live in their own table.
    const { data } = await sb
      .from('owner_credentials')
      .select('session_version')
      .eq('id', verified.user.id)
      .maybeSingle();
    if (!data) return null; // owner row deleted
    if ((data as any).session_version !== verified.version) return null;
    return verified.user;
  }

  // Staff / admin: also enforce active + non-archived in the same lookup.
  // Revoke sets archived_at + active=false; resetting a PIN bumps version.
  const { data } = await sb
    .from('staff_users')
    .select('session_version, active, archived_at')
    .eq('id', verified.user.id)
    .is('archived_at', null)
    .maybeSingle();
  if (!data) return null;
  if (!(data as any).active) return null;
  if ((data as any).session_version !== verified.version) return null;
  return verified.user;
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== 'admin' && user.role !== 'owner') redirect('/dashboard');
  return user;
}

// Owner-only — used for the routes that manage admin PINs.
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== 'owner') redirect('/dashboard');
  return user;
}

export async function apiSession(): Promise<
  { user: SessionUser; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { user };
}

export async function apiAdmin(): Promise<
  { user: SessionUser; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const result = await apiSession();
  if (result.error) return result;
  if (result.user.role !== 'admin' && result.user.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) };
  }
  return result;
}

export async function apiOwner(): Promise<
  { user: SessionUser; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const result = await apiSession();
  if (result.error) return result;
  if (result.user.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Owner access required' }, { status: 403 }) };
  }
  return result;
}
