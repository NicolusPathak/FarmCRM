// app/orders/new/page.tsx — Server Component
import { requireSession } from '@/lib/auth';
import { getCustomer } from '@/lib/db';
import { listProductGroups } from '@/lib/products';
import { isAdminOrOwner } from '@/types';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import NewOrderForm from './NewOrderForm';

export const metadata = { title: 'New Order — Chaudhary Farm' };

interface Props { searchParams: Promise<{ customer?: string }> }

export default async function NewOrderPage({ searchParams }: Props) {
  const user = await requireSession();
  const { customer: customerId } = await searchParams;

  const [preselected, productGroups] = await Promise.all([
    customerId ? getCustomer(customerId) : Promise.resolve(null),
    listProductGroups(),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader
        title="New Order"
        subtitle="Pick from the catalog, review totals, and save the invoice"
        backHref={preselected ? `/customers/${preselected.id}` : '/orders'}
        backLabel={preselected ? preselected.full_name : 'Orders'}
      />
      <NewOrderForm
        preselectedCustomer={preselected}
        productGroups={productGroups}
        isAdmin={isAdminOrOwner(user.role)}
      />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
