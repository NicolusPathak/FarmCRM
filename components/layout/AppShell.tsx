// components/layout/AppShell.tsx
import Sidebar from './Sidebar';
import { computeRetention } from '@/lib/retention';
import type { SessionUser } from '@/types';

interface Props {
  children: React.ReactNode;
  user: SessionUser;
}

export default async function AppShell({ children, user }: Props) {
  // Only admins see the badge; staff don't have access to /admin/retention.
  // computeRetention is cached per-request, so this is cheap even if also rendered on the page.
  let retentionCount = 0;
  if (user.role === 'admin' || user.role === 'owner') {
    try { retentionCount = (await computeRetention()).total; } catch { retentionCount = 0; }
  }

  return (
    <div className="app-shell">
      <Sidebar user={user} retentionCount={retentionCount} />
      <div className="main-area">
        <div className="page-content">
          {children}
        </div>
      </div>
    </div>
  );
}
