// app/orders/[id]/page.tsx — Order detail / invoice (Server Component)
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getOrder } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import InvoiceView from './InvoiceView';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  return { title: order ? `${order.order_number} — Chaudhary Farm` : 'Order Not Found' };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const order  = await getOrder(id);
  if (!order) notFound();

  return (
    <AppShell user={user}>
      <InvoiceView order={order} role={user.role} />
    </AppShell>
  );
}
export const dynamic = 'force-dynamic';
