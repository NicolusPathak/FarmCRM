// app/admin/export/page.tsx — Admin-only CSV export page.
import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import ExportClient from './ExportClient';
import { defaultRange } from '@/lib/date-range';

export const metadata = { title: 'Export — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function ExportPage() {
  const user  = await requireAdmin();
  const range = defaultRange();
  return (
    <AppShell user={user}>
      <PageHeader title="Export" subtitle="Download customer, order, and audit data as CSV." />
      <ExportClient defaultFrom={range.from} defaultTo={range.to} />
    </AppShell>
  );
}
