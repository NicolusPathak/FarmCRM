// app/customers/new/page.tsx — Server component shell
import { requireSession } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import NewCustomerForm from './NewCustomerForm';

export const metadata = { title: 'New Customer — Chaudhary Farm' };

export default async function NewCustomerPage() {
  const user = await requireSession();
  return (
    <AppShell user={user}>
      <PageHeader
        title="New Customer"
        subtitle="Add a new customer to the system"
        backHref="/customers"
        backLabel="All Customers"
      />
      <NewCustomerForm />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
