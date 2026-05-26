// app/admin/products/page.tsx — Admin: edit catalog prices + service fees.
import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import { listProducts } from '@/lib/products';
import ProductsClient from './ProductsClient';

export const metadata = { title: 'Products — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

export default async function ProductsPage() {
  const user = await requireAdmin();
  const products = await listProducts();
  return (
    <AppShell user={user}>
      <PageHeader
        title="Products"
        subtitle="Default prices for the order entry catalog. Staff are locked to these; admin can still override per-line at checkout."
      />
      <ProductsClient initial={products} />
    </AppShell>
  );
}
