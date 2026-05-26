'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Receipt,
  KeyRound,
  Activity,
  Upload,
  LogOut,
  AlertTriangle,
  Settings,
  Download,
  Menu,
  BarChart3,
  Package,
} from 'lucide-react';
import { LoadingLink as Link, useLoadingRouter, useLoadingAction } from '@/components/ui/GlobalLoading';
import type { SessionUser } from '@/types';
import { isAdminOrOwner } from '@/types';

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  adminOnly?: boolean;
  badge?: number;
}

interface Props { user: SessionUser; retentionCount?: number }

export default function Sidebar({ user, retentionCount = 0 }: Props) {
  const pathname = usePathname();
  const router   = useLoadingRouter();
  const withLoading = useLoadingAction();

  // Drawer state for mobile. The CSS does the work below 1024px:
  // sidebar.is-open slides in, .mobile-backdrop.is-open dims the rest.
  // On desktop the class is harmless — the sidebar is already in-view.
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeDrawer = () => setMobileOpen(false);

  // Lock body scroll while drawer is open so the page underneath doesn't
  // scroll when the user swipes inside the drawer. Synchronizing the DOM
  // with React state is the intended use of useEffect.
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  const NAV: NavItem[] = [
    { href: '/dashboard',       label: 'Dashboard', Icon: LayoutDashboard },
    { href: '/customers',       label: 'Customers', Icon: Users },
    { href: '/orders',          label: 'Orders',    Icon: Receipt },
    { href: '/admin/reports',    label: 'End of day', Icon: BarChart3,     adminOnly: true },
    { href: '/admin/retention',  label: 'Retention',  Icon: AlertTriangle, adminOnly: true, badge: retentionCount },
    { href: '/admin/staff',      label: user.role === 'owner' ? 'Admin PINs' : 'Staff PINs', Icon: KeyRound, adminOnly: true },
    { href: '/admin/products',   label: 'Products',   Icon: Package,       adminOnly: true },
    { href: '/admin/activity',   label: 'Activity',   Icon: Activity,      adminOnly: true },
    { href: '/admin/export',     label: 'Export',     Icon: Download,      adminOnly: true },
    { href: '/admin/settings',   label: 'Settings',   Icon: Settings,      adminOnly: true },
  ];

  const signOut = () => withLoading(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  });

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  // Admin sees admin nav too. Owner is special: they have exactly one page
  // (admin management), so we strip the sidebar down to just that link.
  const isOwner = user.role === 'owner';
  const hasAdminAccess = isAdminOrOwner(user.role);
  const items = isOwner
    ? NAV.filter((n) => n.href === '/admin/staff')
    : NAV.filter((n) => !n.adminOnly || hasAdminAccess);
  const showImport = hasAdminAccess && !isOwner;

  return (
    <>
      {/* Mobile top bar — only renders below 1024px (CSS gates display).
          Hamburger toggles the drawer; brand link doubles as a "home"
          shortcut so users never feel stuck without a way back to the
          dashboard. The user's role chip on the right reminds floor
          staff which session they're in (admin/staff). */}
      <div className="mobile-topbar no-print">
        <button
          type="button"
          className="mobile-menu-trigger"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <Menu size={22} strokeWidth={2} />
        </button>
        <Link
          href={isOwner ? '/admin/staff' : '/dashboard'}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
            textDecoration: 'none', color: 'var(--ink)', flex: 1,
          }}
        >
          <Image src="/logo.png" alt="" width={32} height={32} style={{ objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Chaudhary Farm
          </div>
        </Link>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 999,
            background: hasAdminAccess ? 'var(--ink)' : 'var(--surface-2)',
            color: hasAdminAccess ? 'var(--bg)' : 'var(--ink-2)',
            fontSize: 10.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            flexShrink: 0,
          }}
          aria-label={`Signed in as ${user.role}`}
        >
          {user.role}
        </span>
      </div>

      {/* Backdrop — only shown when drawer is open. Tap to close. */}
      <div
        className={`mobile-backdrop no-print${mobileOpen ? ' is-open' : ''}`}
        aria-hidden
        onClick={closeDrawer}
      />

      <aside className={`sidebar no-print${mobileOpen ? ' is-open' : ''}`}>
      {/* Brand */}
      <div style={{ padding: '24px 20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 5, boxShadow: '0 4px 14px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(176,50,43,0.18)' }}>
            <Image src="/logo.png" alt="Chaudhary Farm" width={46} height={46} style={{ objectFit: 'contain' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--sidebar-text)', lineHeight: 1.15, letterSpacing: '-0.01em' }}>Chaudhary Farm</div>
            <div style={{ fontSize: 9.5, color: 'var(--sidebar-text-mute)', marginTop: 3, lineHeight: 1.3 }}>14501 Warbler Ln, Haslet, TX 76052</div>
            <div style={{ fontSize: 9.5, color: 'var(--sidebar-text-mute)', marginTop: 1, lineHeight: 1.3 }}>(347) 348-7538</div>
          </div>
        </div>
      </div>

      {/* Nav — scrolls when admin has too many items for the viewport,
          so the user-card + Sign out stay pinned to the bottom.
          onClick={closeDrawer} closes the mobile drawer when any link is
          tapped; safe on desktop because the drawer is already not-open. */}
      <nav
        onClick={closeDrawer}
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '4px 10px 16px',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}
      >
        {isOwner ? (
          // Owner sidebar: just the one page they're allowed to use.
          <>
            <SectionLabel>Owner</SectionLabel>
            {items.map(item => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </>
        ) : (
          <>
            <SectionLabel>Workspace</SectionLabel>
            {items.filter(i => !i.href.startsWith('/admin')).map(item => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}

            {hasAdminAccess && (
              <>
                <SectionLabel style={{ marginTop: 18 }}>Admin</SectionLabel>
                {items.filter(i => i.href.startsWith('/admin')).map(item => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
                {showImport && (
                  <NavLink
                    item={{ href: '/import', label: 'Import customers', Icon: Upload }}
                    active={isActive('/import')}
                  />
                )}
              </>
            )}
          </>
        )}
      </nav>

      {/* User card — flex-shrink:0 so the Sign out button is always reachable. */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(237,230,216,0.06)', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 12px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: hasAdminAccess ? 'var(--brand)' : 'var(--sidebar-bg-soft)',
            color: 'var(--sidebar-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600, flexShrink: 0,
            border: '1px solid rgba(237,230,216,0.08)',
          }}>{user.name.charAt(0).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sidebar-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--sidebar-text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{user.role}</div>
          </div>
        </div>
        <button onClick={signOut} style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '9px 12px', borderRadius: 10, background: 'transparent',
          border: '1px solid rgba(237,230,216,0.08)', cursor: 'pointer',
          color: 'var(--sidebar-text-mute)', fontSize: 13, fontWeight: 500,
          fontFamily: 'inherit', transition: 'all 120ms',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(237,230,216,0.06)'; (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text-mute)'; }}
        >
          <LogOut size={15} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
    </>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
      color: 'var(--sidebar-text-mute)', padding: '8px 12px 6px', ...style,
    }}>{children}</div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = item;
  const showBadge = typeof item.badge === 'number' && item.badge > 0;
  return (
    <Link href={item.href} style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px', borderRadius: 10, textDecoration: 'none',
      fontSize: 13.5, fontWeight: active ? 600 : 500,
      background: active ? 'var(--sidebar-active)' : 'transparent',
      color: active ? 'var(--sidebar-text)' : 'var(--sidebar-text-mute)',
      transition: 'background 120ms, color 120ms',
    }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text-mute)'; }}
    >
      {active && <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, borderRadius: 2, background: 'var(--brand)' }} />}
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {showBadge && (
        <span style={{
          fontSize: 10.5, fontWeight: 600,
          minWidth: 18, height: 18, padding: '0 6px',
          borderRadius: 999, background: 'var(--brand)', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          letterSpacing: 0,
        }}>{item.badge! > 99 ? '99+' : item.badge}</span>
      )}
    </Link>
  );
}
