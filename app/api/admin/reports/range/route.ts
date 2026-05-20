// app/api/admin/reports/range/route.ts — Report JSON for a date range.
// Single-day reports are just a range where from === to.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { defaultReportDate, getReport, ReportRangeError } from '@/lib/report';
import { safeError } from '@/lib/api-error';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const today = defaultReportDate();
  const from  = req.nextUrl.searchParams.get('from') ?? today;
  const to    = req.nextUrl.searchParams.get('to')   ?? from;

  if (!YYYY_MM_DD.test(from) || !YYYY_MM_DD.test(to)) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  }
  if (to > today) {
    return NextResponse.json({ error: '"to" cannot be in the future' }, { status: 400 });
  }

  try {
    const report = await getReport(from, to);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ReportRangeError) {
      return NextResponse.json({ error: err.publicMessage }, { status: err.status });
    }
    return safeError(err, 'Could not build report.', 'GET /api/admin/reports/range');
  }
}
