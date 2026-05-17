// lib/api-error.ts — Safe API error responses.
// Goal: never leak Postgres / Node stack strings to clients.
// Real errors are console.error'd server-side; clients get a generic message.
import { NextResponse } from 'next/server';

/** Tag a thrown Error with these properties to map it onto a user-safe HTTP response. */
export type TaggedError = Error & {
  code?: string;
  status?: number;
  publicMessage?: string;
  extra?: Record<string, unknown>;
};

export function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status: 400 });
}

export function safeError(err: unknown, fallback: string, route: string): NextResponse {
  // Always log the real thing server-side for debugging.
  console.error(`[api:${route}]`, err);

  // Honor explicit tags from db helpers.
  const t = err as TaggedError;
  if (t && typeof t === 'object' && t.status && t.publicMessage) {
    return NextResponse.json({ error: t.publicMessage, ...(t.extra || {}) }, { status: t.status });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Throw to surface a clean 4xx/5xx response from a db helper. */
export function clientError(publicMessage: string, status = 400, extra?: Record<string, unknown>): never {
  const e = new Error(publicMessage) as TaggedError;
  e.publicMessage = publicMessage;
  e.status = status;
  e.extra = extra;
  throw e;
}
