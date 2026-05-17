'use client';
// components/ui/GlobalLoading.tsx
//
// One centered overlay that any pending navigation or async action can light up.
// - <LoadingLink>: drop-in replacement for next/link's <Link>, auto-reports its
//   pending state via useLinkStatus (Next 16+).
// - useLoadingRouter(): wraps router.push/back/refresh in useTransition so
//   non-link navigation (table-row clicks, etc.) also lights up the overlay.
// - useLoadingAction(): wraps any async function so manual button handlers
//   (sign out, save, delete, fetch+redirect) light up the overlay.
//
// The overlay has a short reveal delay so genuinely fast transitions don't flash.

import {
  createContext, useContext, useState, useCallback, useEffect, useRef,
  useTransition, type ReactNode,
} from 'react';
import Link, { useLinkStatus, type LinkProps } from 'next/link';
import { useRouter } from 'next/navigation';

type Ctx = { incr: () => void; decr: () => void; pending: number };
const LoadingCtx = createContext<Ctx | null>(null);

const REVEAL_DELAY_MS = 120;

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(0);
  const incr = useCallback(() => setPending(p => p + 1), []);
  const decr = useCallback(() => setPending(p => Math.max(0, p - 1)), []);
  return (
    <LoadingCtx.Provider value={{ incr, decr, pending }}>
      {children}
      <CenterOverlay pending={pending} />
    </LoadingCtx.Provider>
  );
}

function CenterOverlay({ pending }: { pending: number }) {
  const [visible, setVisible] = useState(false);

  // Delay the reveal so quick (<120ms) navigations don't flash an overlay.
  useEffect(() => {
    if (pending <= 0) { setVisible(false); return; }
    const t = setTimeout(() => setVisible(true), REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(20, 17, 15, 0.28)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        pointerEvents: 'auto', // block clicks while loading so users can't double-fire
        animation: 'gl-fade-in 140ms ease',
      }}
    >
      <div style={{
        background: 'var(--surface, #fff)',
        borderRadius: 16,
        padding: '20px 26px',
        boxShadow: '0 30px 60px rgba(22,19,17,0.28), 0 2px 0 rgba(255,255,255,0.6) inset',
        display: 'flex', alignItems: 'center', gap: 14,
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
        color: 'var(--ink, #161311)',
        fontSize: 14, fontWeight: 500,
        minWidth: 160, justifyContent: 'center',
      }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none"
          style={{ animation: 'gl-spin 700ms linear infinite', color: 'var(--brand, #B0322B)' }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span>Loading…</span>
      </div>
      <style>{`
        @keyframes gl-spin { to { transform: rotate(360deg); } }
        @keyframes gl-fade-in { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

function useLoadingCtx() {
  const ctx = useContext(LoadingCtx);
  if (!ctx) throw new Error('GlobalLoadingProvider missing — wrap the app in <GlobalLoadingProvider>.');
  return ctx;
}

// Lives inside a <Link> and reports its pending state to the global overlay.
function LinkPendingReporter() {
  const { pending } = useLinkStatus();
  const { incr, decr } = useLoadingCtx();
  const active = useRef(false);

  useEffect(() => {
    if (pending && !active.current) { active.current = true; incr(); }
    else if (!pending && active.current) { active.current = false; decr(); }
  }, [pending, incr, decr]);

  // Always release on unmount, even if pending was still true.
  useEffect(() => () => { if (active.current) { active.current = false; decr(); } }, [decr]);

  return null;
}

// Drop-in replacement for next/link's <Link>. Same props, plus auto-overlay.
// Use it via:  `import { LoadingLink as Link } from '@/components/ui/GlobalLoading';`
type LoadingLinkProps = LinkProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
  children?: ReactNode;
};

export function LoadingLink({ children, ...props }: LoadingLinkProps) {
  return (
    <Link {...props}>
      <LinkPendingReporter />
      {children}
    </Link>
  );
}

// useRouter() replacement: push/back/refresh inside a transition so the
// overlay lights up while the destination renders.
export function useLoadingRouter() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { incr, decr } = useLoadingCtx();
  const active = useRef(false);

  useEffect(() => {
    if (isPending && !active.current) { active.current = true; incr(); }
    else if (!isPending && active.current) { active.current = false; decr(); }
  }, [isPending, incr, decr]);

  useEffect(() => () => { if (active.current) { active.current = false; decr(); } }, [decr]);

  const push = useCallback((href: string) => {
    startTransition(() => { router.push(href); });
  }, [router]);

  const back = useCallback(() => {
    startTransition(() => { router.back(); });
  }, [router]);

  const replace = useCallback((href: string) => {
    startTransition(() => { router.replace(href); });
  }, [router]);

  const refresh = useCallback(() => {
    startTransition(() => { router.refresh(); });
  }, [router]);

  return { push, back, replace, refresh, isPending };
}

// Wrap an async function so the overlay shows while it runs.
// Usage:  const withLoading = useLoadingAction();
//         await withLoading(() => fetch('/api/...'));
export function useLoadingAction() {
  const { incr, decr } = useLoadingCtx();
  return useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    incr();
    try { return await fn(); } finally { decr(); }
  }, [incr, decr]);
}
