// lib/audit.ts — Append-only audit trail of who-did-what.
//
// Reliability model (Phase 2 hardening, code-only):
//   - logAudit retries up to 3x with backoff before giving up.
//   - logAuditOrFail throws on final failure; callers can pair this with a
//     compensating rollback of the just-completed mutation so we approximate
//     a transaction without actually having one.
//   - getRequestContext() captures the caller's IP + user-agent and stores
//     them inside `changes._meta` (the only place we can put per-row metadata
//     without a schema change).
import { headers } from 'next/headers';
import { createSupabaseAdminClient } from './supabase-server';
import { clientIpFromHeaders } from './request-ip';
import type { SessionUser, AuditChanges } from '@/types';

export type EntityType = 'customer' | 'order' | 'staff' | 'export' | 'settings' | 'category';
export type AuditAction =
  | 'created'
  | 'updated'
  | 'voided'
  | 'archived'
  | 'restored'
  | 'pin_created'
  | 'pin_revoked'
  | 'pin_reset'
  | 'staff_login'
  | 'owner_login'
  | 'points_adjusted'
  | 'order_reassigned'
  // Export events — written by export endpoints so the owner can audit who
  // pulled what data out and when.
  | 'export.customers'
  | 'export.orders'
  | 'export.audit';

interface LogArgs {
  actor: SessionUser;
  action: AuditAction;
  entity_type: EntityType;
  entity_id?: string | null;
  entity_label?: string | null;
  changes?: AuditChanges;
}

const MAX_RETRIES = 3;
const BASE_DELAY  = 200; // ms; backoff: 200, 400, 800

/** Best-effort logger. Caller wants the mutation to succeed even if audit fails. */
export async function logAudit(args: LogArgs): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await logAuditOrFail(args);
    return { ok: true };
  } catch (e) {
    // We log loudly so this isn't silent in prod.
    console.error('[audit] gave up after retries — action committed without a log row:', e, args);
    return { ok: false, error: e };
  }
}

/** Strict logger. Throws on final failure. Pair with a compensating rollback. */
export async function logAuditOrFail(args: LogArgs): Promise<void> {
  const sb = createSupabaseAdminClient();

  // Capture per-request context (IP + UA) and fold into changes._meta.
  // headers() is server-only; if absent (e.g., in tests), we skip silently.
  // IP comes from `clientIpFromHeaders` so the audit log matches what the
  // rate-limit logic sees — prevents an attacker spoofing X-Forwarded-For
  // from poisoning the audit trail with a fake "client IP."
  let meta: Record<string, string> = {};
  try {
    const h = await headers();
    const ip = clientIpFromHeaders(h);
    const ua = h.get('user-agent') ?? '';
    if (ip && ip !== 'local') meta.ip = ip;
    if (ua) meta.user_agent = ua.slice(0, 300);
  } catch { /* no request context (e.g., script/test) */ }

  const changes = { ...(args.changes ?? {}), ...(Object.keys(meta).length ? { _meta: meta } : {}) };

  // Owner IDs live in owner_credentials, not staff_users, so the FK on
  // audit_log.actor_id → staff_users(id) would fail. Store null instead; the
  // actor_name + actor_role columns still record who did it.
  const actorId = args.actor.role === 'owner' ? null : args.actor.id;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { error } = await sb.from('audit_log').insert({
      actor_id:     actorId,
      actor_name:   args.actor.name,
      actor_role:   args.actor.role,
      action:       args.action,
      entity_type:  args.entity_type,
      entity_id:    args.entity_id ?? null,
      entity_label: args.entity_label ?? null,
      changes,
    } as any);
    if (!error) return;
    lastErr = error;
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, BASE_DELAY * Math.pow(2, attempt)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('audit insert failed after retries');
}

/** Diff two objects across the given keys. Only includes keys whose values changed. */
export function diffFields<T>(
  before: T,
  after: Partial<T>,
  keys: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (!(k in (after as object))) continue;
    const a = (before as any)[k] ?? null;
    const b = (after as any)[k] ?? null;
    if (a !== b) out[String(k)] = { from: a, to: b };
  }
  return out;
}
