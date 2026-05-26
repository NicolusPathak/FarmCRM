// app/customers/page.tsx — Server Component, renders customer list
import { requireSession } from '@/lib/auth';
import { listCustomers, searchCustomers } from '@/lib/db';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import CustomersClient from './CustomersClient';
import { UserPlus } from 'lucide-react';
import { LoadingLink as Link } from '@/components/ui/GlobalLoading';

export const metadata = { title: 'Customers — Chaudhary Farm' };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

const PAGE_SIZE = 50;

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireSession();
  const { q = '' } = await searchParams;

  // When the user lands with a query in the URL we honor it (one-shot
  // search). When there's no query we serve the first paginated page so
  // they can browse and "Load more" past the initial slice.
  const initialQuery = q.trim();
  let initialCustomers; let initialTotal;
  if (initialQuery) {
    initialCustomers = await searchCustomers(initialQuery);
    initialTotal     = initialCustomers.length;
  } else {
    const page = await listCustomers({ limit: PAGE_SIZE });
    initialCustomers = page.customers;
    initialTotal     = page.total;
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Customers"
        subtitle={initialQuery
          ? `${initialCustomers.length} matching "${initialQuery}"`
          : `${initialTotal} customer${initialTotal !== 1 ? 's' : ''}`}
        actions={
          <Link href="/customers/new" className="btn-primary">
            <UserPlus size={16} />
            New Customer
          </Link>
        }
      />
      <CustomersClient
        customers={initialCustomers}
        total={initialTotal}
        pageSize={PAGE_SIZE}
        initialQuery={q}
      />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
