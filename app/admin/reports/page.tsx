// app/admin/reports/page.tsx — Sales report (single day or range).
import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/layout/PageHeader';
import ReportClient from './ReportClient';
import { defaultReportDate, getReport, loadCategoriesWithAliases } from '@/lib/report';

export const metadata = { title: 'Sales report — Chaudhary Farm' };
export const dynamic  = 'force-dynamic';

interface PageProps { searchParams: Promise<{ from?: string; to?: string }> }

export default async function ReportsPage({ searchParams }: PageProps) {
  const user   = await requireAdmin();
  const params = await searchParams;
  const today  = defaultReportDate();
  // Default: today only. URL params override.
  const from   = params.from ?? today;
  const to     = params.to   ?? from;

  const [report, categories] = await Promise.all([
    getReport(from, to),
    loadCategoriesWithAliases(),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Sales report"
        subtitle="Today, this week, this month, or any custom range — broken down by category."
      />
      <ReportClient
        initialReport={report}
        initialCategories={categories}
        initialFrom={from}
        initialTo={to}
        today={today}
      />
    </AppShell>
  );
}
