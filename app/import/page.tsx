// app/import/page.tsx — Admin-only bulk import page
import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import ImportClient from './ImportClient';

export const metadata = { title: 'Import Customers — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function ImportPage() {
  const user = await requireAdmin();
  return (
    <AppShell user={user}>
      <PageHeader title="Import Customers" subtitle="One-time Excel import. Upload your spreadsheet to get started." backHref="/customers" backLabel="Customers" />
      <ImportClient />
    </AppShell>
  );
}
