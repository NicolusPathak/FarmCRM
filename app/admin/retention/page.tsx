// app/admin/retention/page.tsx — Admin: customers we may be losing.
import { requireAdmin } from '@/lib/auth';
import { computeRetention } from '@/lib/retention';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import RetentionClient from './RetentionClient';
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';
import { Settings } from 'lucide-react';

export const metadata = { title: 'Retention — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function RetentionPage() {
  const user   = await requireAdmin();
  const result = await computeRetention();

  return (
    <AppShell user={user}>
      <PageHeader
        title="Retention concerns"
        subtitle={`${result.total} customer${result.total === 1 ? '' : 's'} worth reaching out to`}
        actions={
          <Link href="/admin/settings" className="btn-secondary">
            <Settings size={14} /> Thresholds
          </Link>
        }
      />
      <RetentionClient initial={result} />
    </AppShell>
  );
}
