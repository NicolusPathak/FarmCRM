// app/admin/categories/page.tsx — Admin: manage item categories + aliases.
import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import CategoriesClient from './CategoriesClient';
import { loadCategoriesWithAliases } from '@/lib/report';

export const metadata = { title: 'Categories — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function CategoriesPage() {
  const user = await requireAdmin();
  const categories = await loadCategoriesWithAliases();
  return (
    <AppShell user={user}>
      <PageHeader
        title="Item categories"
        subtitle="Buckets used by the end-of-day report. Aliases are the typed item names that should roll up into each category."
      />
      <CategoriesClient initial={categories} />
    </AppShell>
  );
}
