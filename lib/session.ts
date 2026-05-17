// lib/session.ts — HMAC-signed session cookie using Web Crypto.
// Server-only. Cookie format: <base64url(JSON)>.<base64url(HMAC-SHA256)>
import type { SessionUser } from '@/types';

const COOKIE_NAME = 'cf_session';
const ONE_DAY = 60 * 60 * 24;
const TTL_SECONDS = ONE_DAY * 30;

interface Payload extends SessionUser {
  exp: number;
  // session_version snapshot at login time. The caller of verifySession
  // compares this against the user row's current session_version to detect
  // revocation / PIN reset / owner password change without needing to
  // expire the cookie.
  v: number;
}

export interface VerifiedSession {
  user: SessionUser;
  version: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  // Backing buffer typed as ArrayBuffer (not ArrayBufferLike) so it satisfies BufferSource.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET env var must be set to a value of at least 32 characters');
  }
  return secret;
}

export async function signSession(user: SessionUser, version: number): Promise<string> {
  const payload: Payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    v: version,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(getSecret());
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

// HMAC + expiry verify. Returns the decoded user + the version stamped at
// login time so the caller can compare against the row's current version.
// Does NOT touch the database — callers needing live revocation checks
// should use `getSession()` / `apiSession()` in lib/auth.ts.
export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  try {
    const key = await hmacKey(getSecret());
    const ok  = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig) as BufferSource, new TextEncoder().encode(body));
    if (!ok) return null;
    const json = new TextDecoder().decode(b64urlDecode(body));
    const payload = JSON.parse(json) as Payload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.id || !payload.name || !payload.role) return null;
    return {
      user: { id: payload.id, name: payload.name, role: payload.role },
      // Sessions issued before this column existed encoded no `v` field.
      // Treat them as version 0 so they match a freshly-migrated row's default.
      version: typeof payload.v === 'number' ? payload.v : 0,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = TTL_SECONDS;

// Hash a PIN to a deterministic HMAC digest so we can look it up directly.
// Per-row salt would mean iterating every staff row on each login.
export async function hashPin(pin: string): Promise<string> {
  const secret = process.env.PIN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('PIN_SECRET env var must be set to a value of at least 32 characters');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pin));
  return b64urlEncode(new Uint8Array(sig));
}
