// lib/request-ip.ts — Trusted client-IP extraction for rate-limiting.
//
// Why this exists:
//   The previous code took `X-Forwarded-For.split(',')[0]`. On Vercel,
//   X-Forwarded-For is built by APPENDING the connecting IP to whatever
//   the client supplied — so the leftmost element is fully attacker-
//   controlled. An attacker can send `X-Forwarded-For: 1.2.3.4` on every
//   request and the rate-limit logic sees a "fresh IP" each time, defeating
//   the lockout entirely.
//
//   The trustworthy values, in order of preference:
//     1. `x-real-ip`  — Vercel-set, single value, NOT user-supplied
//     2. The LAST entry of `x-forwarded-for` — the IP your edge proxy saw,
//        which sits on the right side of the chain because additional
//        proxies append rather than prepend
//
//   Falling back to 'local' is intentional: in dev / tests with no proxy
//   headers, everyone shares one bucket. That's fine for a dev terminal.
import type { NextRequest } from 'next/server';

export function clientIp(req: NextRequest): string {
  return clientIpFromHeaders(req.headers);
}

// Variant for places that receive a Headers object (server components,
// audit logger via `next/headers`). Same logic as clientIp; extracted so
// both call sites use the same trusted-header rules.
export function clientIpFromHeaders(h: Headers): string {
  const real = h.get('x-real-ip');
  if (real && real.trim()) return real.trim();

  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return 'local';
}
