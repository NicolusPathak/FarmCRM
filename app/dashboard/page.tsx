// app/dashboard/page.tsx — Server Component
import { requireSession } from '@/lib/auth';
import { getDashboardStats } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import DashboardClient from './DashboardClient';

export const metadata = { title: 'Dashboard — Chaudhary Farm' };

export default async function DashboardPage() {
  const user  = await requireSession();
  const stats = await getDashboardStats(user.role);

  return (
    <AppShell user={user}>
      <DashboardClient stats={stats} role={user.role} />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
