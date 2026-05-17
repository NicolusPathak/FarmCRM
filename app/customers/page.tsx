// app/customers/page.tsx — Server Component, renders customer list
import { requireSession } from '@/lib/auth';
import { searchCustomers } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import CustomersClient from './CustomersClient';
import { UserPlus } from 'lucide-react';
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';

export const metadata = { title: 'Customers — Chaudhary Farm' };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireSession();
  const { q = '' } = await searchParams;
  const customers = await searchCustomers(q);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customer${customers.length !== 1 ? 's' : ''}${q ? ` matching "${q}"` : ''}`}
        actions={
          <Link href="/customers/new" className="btn-primary">
            <UserPlus size={16} />
            New Customer
          </Link>
        }
      />
      <CustomersClient customers={customers} initialQuery={q} />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
