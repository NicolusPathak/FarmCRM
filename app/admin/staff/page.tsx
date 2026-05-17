// app/admin/staff/page.tsx — PIN management.
// Owner sees ADMIN PINs only. Admin sees STAFF PINs only. Each tier
// manages exactly the tier below it; nobody manages their peers.
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-server';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import StaffClient from './StaffClient';
import type { StaffUser } from '@/types';

export const metadata = { title: 'PINs — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function StaffPage() {
  const user = await requireAdmin();
  const sb   = createSupabaseAdminClient();

  // Owner manages admins; admin manages staff.
  const managedRole: 'admin' | 'staff' = user.role === 'owner' ? 'admin' : 'staff';

  const { data } = await sb
    .from('staff_users')
    .select('id, name, role, active, created_at, created_by, archived_at')
    .is('archived_at', null)
    .eq('role', managedRole)
    .order('created_at', { ascending: false });

  const title    = managedRole === 'admin' ? 'Admin PINs' : 'Staff PINs';
  const subtitle = managedRole === 'admin'
    ? 'Create, reset, or revoke admin PINs. Admins manage staff PINs themselves.'
    : 'Create or revoke staff PINs. The owner manages admin PINs.';

  return (
    <AppShell user={user}>
      <PageHeader title={title} subtitle={subtitle} />
      <StaffClient
        initial={(data as StaffUser[]) ?? []}
        currentUserId={user.id}
        managedRole={managedRole}
      />
    </AppShell>
  );
}
