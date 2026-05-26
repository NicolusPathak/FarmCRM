// app/orders/page.tsx — Orders list (Server Component)
import { requireSession } from '@/lib/auth';
import { listOrders } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import OrdersClient from './OrdersClient';
import { Plus } from 'lucide-react';
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';

export const metadata = { title: 'Orders — Chaudhary Farm' };

const PAGE_SIZE = 50;

export default async function OrdersPage() {
  const user = await requireSession();
  const { orders, total } = await listOrders({ limit: PAGE_SIZE });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Orders"
        subtitle={`${total} order${total !== 1 ? 's' : ''}`}
        actions={
          <Link href="/orders/new" className="btn-primary">
            <Plus size={16} /> New Order
          </Link>
        }
      />
      <OrdersClient orders={orders} total={total} pageSize={PAGE_SIZE} />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
