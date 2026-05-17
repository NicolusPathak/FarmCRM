// app/admin/activity/page.tsx — Admin audit log viewer.
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import ActivityClient from './ActivityClient';
import type { AuditLogEntry } from '@/types';

export const metadata = { title: 'Activity — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function ActivityPage() {
  const user = await requireAdmin();
  const sb   = createSupabaseAdminClient();
  const { data, count } = await sb
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(0, PAGE_SIZE - 1);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Activity"
        subtitle="Every customer, order, and PIN change made by staff or admins."
      />
      <ActivityClient initial={(data as AuditLogEntry[]) ?? []} total={count ?? 0} pageSize={PAGE_SIZE} />
    </AppShell>
  );
}
