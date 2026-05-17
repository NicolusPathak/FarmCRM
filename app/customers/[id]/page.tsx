// app/customers/[id]/page.tsx — Server Component
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getCustomer, getCustomerOrders } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import CustomerProfile from './CustomerProfile';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomer(id);
  return { title: customer ? `${customer.full_name} — Chaudhary Farm` : 'Customer Not Found' };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const [customer, orders] = await Promise.all([
    getCustomer(id),
    getCustomerOrders(id),
  ]);

  if (!customer) notFound();

  return (
    <AppShell user={user}>
      <CustomerProfile customer={customer} orders={orders} role={user.role} />
    </AppShell>
  );
}
export const dynamic = 'force-dynamic';
