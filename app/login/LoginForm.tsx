'use client';
// app/login/LoginForm.tsx — 4-digit PIN entry for Chaudhary Farm, plus
// a small "Hero Go" button below the keypad that swaps the card to a
// username/password form for the owner.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Delete, Bird, ArrowLeft, KeyRound } from 'lucide-react';

const MAX_LEN = 4;
const FLY_MS = 900;

type Mode = 'pin' | 'hero';

export default function LoginForm() {
  const router = useRouter();
  const hiddenInput = useRef<HTMLInputElement>(null);

  // Shared
  const [mode, setMode]   = useState<Mode>('pin');
  const [flying, setFlying] = useState(false);

  // PIN mode
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [shake, setShake]     = useState(false);

  // Hero mode
  const [username,     setUsername]     = useState('');
  const [password,     setPassword]     = useState('');
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError,   setOwnerError]   = useState('');

  useEffect(() => {
    if (mode === 'pin') hiddenInput.current?.focus();
  }, [mode]);

  async function submit(value: string) {
    if (loading || flying) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: 'Sign-in failed' }));
        setError(msg || 'Invalid PIN.');
        setShake(true);
        setTimeout(() => setShake(false), 380);
        setPin('');
        setLoading(false);
        // Defer focus until after React re-enables the input (disabled={loading}).
        setTimeout(() => hiddenInput.current?.focus(), 0);
        return;
      }
      // Success — let the chicken fly across the screen, THEN navigate.
      setLoading(false);
      setFlying(true);
      setTimeout(() => {
        router.push('/dashboard');
        router.refresh();
      }, FLY_MS);
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  function setDigits(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, MAX_LEN);
    setPin(digits);
    setError('');
    if (digits.length === MAX_LEN) setTimeout(() => submit(digits), 80);
  }

  function press(d: string) {
    if (loading || flying) return;
    if (d === 'del') { setPin(p => p.slice(0, -1)); setError(''); return; }
    setDigits(pin + d);
  }

  async function submitOwner(e: React.FormEvent) {
    e.preventDefault();
    if (ownerLoading || flying) return;
    if (!username.trim() || !password) {
      setOwnerError('Enter a username and password.');
      return;
    }
    setOwnerLoading(true);
    setOwnerError('');
    try {
      const res = await fetch('/api/auth/owner-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: 'Sign-in failed' }));
        setOwnerError(msg || 'Sign-in failed.');
        setOwnerLoading(false);
        setPassword('');
        return;
      }
      // Same celebratory flyby as PIN login. Owner lands on the admin-PINs page.
      setOwnerLoading(false);
      setFlying(true);
      setTimeout(() => {
        router.push('/admin/staff');
        router.refresh();
      }, FLY_MS);
    } catch {
      setOwnerError('Network error. Try again.');
      setOwnerLoading(false);
    }
  }

  // PIN-mode focus guard: if focus drifts off the hidden input (e.g. the
  // user taps somewhere else on the card), pull it back so keystrokes are
  // captured. The keyboard itself is handled by the input's onChange — a
  // second window-level keydown listener would double-fire every digit
  // (it adds one, then the input event adds another, racing React's
  // controlled re-render).
  useEffect(() => {
    if (mode !== 'pin') return;
    const refocus = () => {
      if (loading || flying) return;
      if (document.activeElement !== hiddenInput.current) {
        hiddenInput.current?.focus();
      }
    };
    window.addEventListener('keydown', refocus);
    return () => window.removeEventListener('keydown', refocus);
  }, [loading, flying, mode]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      background: 'radial-gradient(120% 80% at 50% 0%, #F4EFE4 0%, var(--bg) 60%)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div className="dot-grid" style={{ position: 'absolute', inset: 0, opacity: 0.4, pointerEvents: 'none' }} />

      <div className="fade-up" style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{
            width: 180, height: 180, margin: '0 auto 20px',
            borderRadius: 44, background: 'var(--surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 24px 60px rgba(22,19,17,0.12), 0 2px 0 #fff inset',
            border: '1px solid var(--border)',
            position: 'relative',
          }}>
            <div aria-hidden style={{
              position: 'absolute', inset: -10, borderRadius: 50, zIndex: 0,
              background: 'radial-gradient(circle at 50% 30%, rgba(176,50,43,0.10), transparent 65%)',
              filter: 'blur(8px)',
            }} />
            <Image src="/logo.png" alt="Chaudhary Farm" width={148} height={148} priority style={{ objectFit: 'contain', position: 'relative', zIndex: 1 }} />
          </div>
          <h1 className="font-display" style={{ fontSize: 32, margin: 0 }}>
            Chaudhary Farm
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 6, letterSpacing: '0.02em' }}>
            Sign in to continue
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12, lineHeight: 1.5 }}>
            14501 Warbler Ln, Haslet, TX 76052<br />
            (347) 348-7538
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '24px 22px 22px', boxShadow: 'var(--shadow-md)' }}>
          {mode === 'pin' ? (
            <>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', marginBottom: 18 }}>
                Enter your 4-digit PIN
              </p>

              {/* Dots */}
              <div
                style={{
                  display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 22,
                  animation: shake ? 'shake 380ms ease-in-out' : undefined,
                }}
              >
                {Array.from({ length: MAX_LEN }).map((_, i) => {
                  const filled = i < pin.length;
                  return (
                    <span
                      key={i}
                      style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: filled ? 'var(--ink)' : 'transparent',
                        border: filled ? '1px solid var(--ink)' : '1.5px solid var(--border)',
                        transform: filled ? 'scale(1)' : 'scale(0.85)',
                        transition: 'all 140ms cubic-bezier(.4,.0,.2,1)',
                      }}
                    />
                  );
                })}
              </div>

              <input
                ref={hiddenInput}
                type="tel" inputMode="numeric" autoComplete="one-time-code" pattern="\d*"
                value={pin}
                onChange={e => setDigits(e.target.value)}
                disabled={loading}
                aria-label="PIN"
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
              />

              {/* Number pad */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['1','2','3','4','5','6','7','8','9','','0','del'].map((d, i) => {
                  if (d === '') return <div key={i} />;
                  const isDel = d === 'del';
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => press(d)}
                      disabled={loading}
                      style={{
                        padding: '14px 0',
                        fontSize: isDel ? 16 : 22,
                        fontWeight: 500,
                        fontFamily: 'inherit',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 14,
                        color: 'var(--ink)',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        transition: 'all 100ms',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: 56,
                      }}
                      onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)'; }}
                      onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                    >
                      {isDel ? <Delete size={18} strokeWidth={1.8} /> : d}
                    </button>
                  );
                })}
              </div>

              <div style={{ minHeight: 28, marginTop: 16, textAlign: 'center' }}>
                {loading && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-muted)' }}>
                    <span className="chick-spin" style={{ display: 'inline-flex' }}>
                      <Bird size={18} strokeWidth={1.8} />
                    </span>
                    Signing in…
                  </div>
                )}
                {error && !loading && (
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>
                    {error}
                  </div>
                )}
              </div>

              {/* Hero Go — below the keypad. Plain styling so it doesn't shout
                  "high-value account here" to anyone looking at the page. */}
              <button
                type="button"
                onClick={() => { setMode('hero'); setError(''); setPin(''); }}
                disabled={loading || flying}
                style={{
                  marginTop: 12, width: '100%',
                  padding: '11px 0',
                  background: 'transparent',
                  border: '1px dashed var(--border)',
                  borderRadius: 12,
                  color: 'var(--ink-muted)',
                  fontSize: 12.5, fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'inherit',
                  cursor: (loading || flying) ? 'not-allowed' : 'pointer',
                  transition: 'all 120ms',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--ink-2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              >
                Hero Go
              </button>
            </>
          ) : (
            // ── Hero (owner) login: username + password ─────────────
            <form onSubmit={submitOwner} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', margin: 0, marginBottom: 4 }}>
                Owner sign-in
              </p>

              <div>
                <label className="label" htmlFor="hero-username">Username</label>
                <input
                  id="hero-username"
                  className="input-field"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setOwnerError(''); }}
                  disabled={ownerLoading || flying}
                />
              </div>

              <div>
                <label className="label" htmlFor="hero-password">Password</label>
                <input
                  id="hero-password"
                  className="input-field"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setOwnerError(''); }}
                  disabled={ownerLoading || flying}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={ownerLoading || flying || !username.trim() || !password}
                style={{ padding: '12px 0', marginTop: 4 }}
              >
                {ownerLoading ? (
                  <>
                    <span className="chick-spin" style={{ display: 'inline-flex' }}>
                      <Bird size={16} strokeWidth={1.8} />
                    </span>
                    Signing in…
                  </>
                ) : (
                  <>
                    <KeyRound size={14} /> Sign in
                  </>
                )}
              </button>

              <div style={{ minHeight: 20, textAlign: 'center' }}>
                {ownerError && !ownerLoading && (
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>
                    {ownerError}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setMode('pin');
                  setUsername(''); setPassword(''); setOwnerError('');
                }}
                disabled={ownerLoading || flying}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-muted)',
                  fontSize: 12.5, fontWeight: 600,
                  letterSpacing: '0.04em',
                  fontFamily: 'inherit',
                  cursor: ownerLoading ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  margin: '0 auto',
                  padding: '4px 8px',
                }}
              >
                <ArrowLeft size={12} /> Back to PIN
              </button>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 22, letterSpacing: '0.04em' }}>
          Private staff terminal · Chaudhary Farm
        </p>
      </div>

      {/* Chicken flyby — same animation for either login path. */}
      {flying && (
        <div aria-hidden style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200,
          overflow: 'hidden',
        }}>
          <div className="chick-fly" style={{
            position: 'absolute', top: '50%', left: 0,
            color: 'var(--brand)',
            filter: 'drop-shadow(0 6px 12px rgba(15,23,42,0.18))',
          }}>
            <Bird size={120} strokeWidth={1.6} />
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shake {
          0%, 100%      { transform: translateX(0); }
          15%, 45%, 75% { transform: translateX(-7px); }
          30%, 60%, 90% { transform: translateX(7px); }
        }

        /* Wobbly spin for the loading chicken — full rotation looks weird on a bird,
           so we use an oscillating tilt with a slight bob instead. */
        :global(.chick-spin) {
          animation: chick-spin 700ms cubic-bezier(.4,.0,.2,1) infinite;
          transform-origin: center;
        }
        @keyframes chick-spin {
          0%   { transform: rotate(-14deg) translateY(0); }
          25%  { transform: rotate(8deg)  translateY(-2px); }
          50%  { transform: rotate(-10deg) translateY(0); }
          75%  { transform: rotate(12deg) translateY(-2px); }
          100% { transform: rotate(-14deg) translateY(0); }
        }

        /* Flyby: starts off-screen left, arcs slightly, exits off-screen right. */
        :global(.chick-fly) {
          animation: chick-fly ${FLY_MS}ms cubic-bezier(.45,.02,.55,1) forwards;
          will-change: transform, opacity;
        }
        @keyframes chick-fly {
          0%   { transform: translate(-160px, -50%) rotate(-6deg) scale(0.85); opacity: 0; }
          12%  { opacity: 1; }
          50%  { transform: translate(50vw, calc(-50% - 28px)) rotate(4deg) scale(1); }
          88%  { opacity: 1; }
          100% { transform: translate(calc(100vw + 160px), -50%) rotate(-2deg) scale(0.9); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
