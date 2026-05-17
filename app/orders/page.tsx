// app/orders/page.tsx — Orders list (Server Component)
import { requireSession } from '@/lib/auth';
import { getRecentOrders } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import OrdersClient from './OrdersClient';
import { Plus } from 'lucide-react';
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';

export const metadata = { title: 'Orders — Chaudhary Farm' };

export default async function OrdersPage() {
  const user   = await requireSession();
  const orders = await getRecentOrders(50);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Orders"
        subtitle={`${orders.length} recent order${orders.length !== 1 ? 's' : ''}`}
        actions={
          <Link href="/orders/new" className="btn-primary">
            <Plus size={16} /> New Order
          </Link>
        }
      />
      <OrdersClient orders={orders} />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
