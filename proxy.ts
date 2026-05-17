// ============================================================
// proxy.ts  (Next.js 16 Proxy — runs on every request)
//
// Route gates:
//   - "/" → /dashboard (admin/staff), /admin/staff (owner), or /login
//   - Protected paths → /login if not signed in
//   - /admin/*, /import → admin or owner (staff get sent to /dashboard)
//   - Owner is locked to /admin/staff only — they have no day-to-day pages,
//     so any other protected path bounces them back to admin management.
//   - Signed-in user hitting /login → their default landing
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

const PROTECTED  = ['/dashboard', '/customers', '/orders', '/import', '/admin'];
const ADMIN_ONLY = ['/admin', '/import'];
const OWNER_HOME = '/admin/staff';

function defaultLandingFor(role: 'admin' | 'staff' | 'owner'): string {
  return role === 'owner' ? OWNER_HOME : '/dashboard';
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Middleware uses the cheap crypto-only check (no DB hit). Live revocation
  // is enforced at the application layer via getSession in lib/auth.ts;
  // a revoked user passing through here will be kicked out by the page or
  // API route they land on.
  const verified = await verifySession(token);
  const user = verified?.user ?? null;
  const { pathname } = request.nextUrl;

  if (pathname === '/') {
    return NextResponse.redirect(new URL(user ? defaultLandingFor(user.role) : '/login', request.url));
  }

  const isProtected = PROTECTED.some((r) => pathname === r || pathname.startsWith(r + '/'));
  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/dashboard') loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Owner is allowed exactly one app page: /admin/staff. Any other protected
  // route — admin or not — bounces them back to admin management.
  if (user?.role === 'owner' && isProtected && pathname !== OWNER_HOME && !pathname.startsWith(OWNER_HOME + '/')) {
    return NextResponse.redirect(new URL(OWNER_HOME, request.url));
  }

  const isAdminOnly = ADMIN_ONLY.some((r) => pathname === r || pathname.startsWith(r + '/'));
  if (isAdminOnly && user && user.role !== 'admin' && user.role !== 'owner') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL(defaultLandingFor(user.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo\\.png|api/auth/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
