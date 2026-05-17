// app/admin/settings/page.tsx — Admin: tune retention thresholds.
import { requireAdmin } from '@/lib/auth';
import { getRetentionSettings } from '@/lib/retention';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import SettingsClient from './SettingsClient';

export const metadata = { title: 'Settings — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireAdmin();
  const retention = await getRetentionSettings();

  // Pull last-changed metadata so the admin can see who tuned this and when.
  // updated_by may point to an archived staff row (FK is ON DELETE SET NULL)
  // or be null (owner edited, or never edited since seed insert).
  const sb = createSupabaseAdminClient();
  const { data: meta } = await sb
    .from('app_settings')
    .select('updated_at, staff_users(name)')
    .eq('key', 'retention')
    .maybeSingle();
  const lastUpdatedAt   = (meta as any)?.updated_at ?? null;
  const lastUpdatedName = (meta as any)?.staff_users?.name ?? null;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Settings"
        subtitle="Tune how the retention concerns are calculated."
        backHref="/admin/retention"
        backLabel="Retention"
      />
      <SettingsClient
        initial={retention}
        lastUpdatedAt={lastUpdatedAt}
        lastUpdatedName={lastUpdatedName}
      />
    </AppShell>
  );
}
