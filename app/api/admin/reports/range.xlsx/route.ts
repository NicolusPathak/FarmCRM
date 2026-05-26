// app/api/admin/reports/range.xlsx/route.ts — Multi-sheet styled Excel export.
//
// The CSV counterpart is intentionally bare-bones. This route returns a
// proper Excel workbook with currency formatting, bold headers, and
// per-category fill colors so the admin's accountant doesn't have to
// re-format anything before sending it on.
//
// Sheets:
//   Overview    — date range + headline KPIs.
//   By Category — one row per category with its color swatch + totals.
//   Items       — one row per item bucket (sorted by category, then revenue).
//   Daily       — one row per day (only when the range spans more than one day).
//
// Styling notes: SheetJS community edition supports a limited cell-style
// API via `cellStyles: true` on write. Colors are passed as RRGGBB hex
// (no leading #). If a viewer doesn't honor styles, the workbook still
// opens with correct data — the colors just don't render.
import type { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { apiAdmin } from '@/lib/auth';
import { logAuditOrFail } from '@/lib/audit';
import { attachmentHeader } from '@/lib/csv';
import { safeError } from '@/lib/api-error';
import { defaultReportDate, getReport, ReportRangeError } from '@/lib/report';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// SheetJS style helpers — these properties are recognized by the writer
// when { cellStyles: true } is passed. Anything not honored is ignored.
type CellStyle = Record<string, unknown>;
const BORDER_THIN = { style: 'thin', color: { rgb: 'D6CFC0' } };
const ALL_BORDERS = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

const headerStyle: CellStyle = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { patternType: 'solid', fgColor: { rgb: '1A1715' } },
  alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
  border: ALL_BORDERS,
};

function categoryStyle(hex: string): CellStyle {
  const rgb = (hex.startsWith('#') ? hex.slice(1) : hex).toUpperCase().padStart(6, '0').slice(0, 6);
  return {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb } },
    alignment: { vertical: 'center' },
    border: ALL_BORDERS,
  };
}

const totalStyle: CellStyle = {
  font: { bold: true, sz: 12 },
  fill: { patternType: 'solid', fgColor: { rgb: 'F3EFE8' } },
  alignment: { vertical: 'center' },
  border: { ...ALL_BORDERS, top: { style: 'medium', color: { rgb: '1A1715' } } },
};

const moneyStyle: CellStyle = {
  numFmt: '"$"#,##0.00',
  alignment: { horizontal: 'right' },
  border: ALL_BORDERS,
};
const qtyStyle: CellStyle = {
  numFmt: '#,##0.###',
  alignment: { horizontal: 'right' },
  border: ALL_BORDERS,
};
const pctStyle: CellStyle = {
  numFmt: '0.0%',
  alignment: { horizontal: 'right' },
  border: ALL_BORDERS,
};
const intStyle: CellStyle = {
  numFmt: '#,##0',
  alignment: { horizontal: 'right' },
  border: ALL_BORDERS,
};
const textStyle: CellStyle = {
  alignment: { vertical: 'center', wrapText: true },
  border: ALL_BORDERS,
};

// Build a styled cell. `v` is the value, `s` the style object.
function cell(v: string | number, s?: CellStyle): XLSX.CellObject {
  if (typeof v === 'number') return { t: 'n', v, s };
  return { t: 's', v, s };
}

// Cell with a colored fill (used to render a "color swatch" in column 1 of
// the By Category sheet). The cell is blank — color comes from the fill.
function swatch(hex: string): XLSX.CellObject {
  const rgb = (hex.startsWith('#') ? hex.slice(1) : hex).toUpperCase().padStart(6, '0').slice(0, 6);
  return { t: 's', v: '', s: { fill: { patternType: 'solid', fgColor: { rgb } }, border: ALL_BORDERS } };
}

export async function GET(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const today = defaultReportDate();
  const from  = req.nextUrl.searchParams.get('from') ?? today;
  const to    = req.nextUrl.searchParams.get('to')   ?? from;

  if (!YYYY_MM_DD.test(from) || !YYYY_MM_DD.test(to)) {
    return err(400, 'from/to must be YYYY-MM-DD');
  }
  if (to > today) return err(400, '"to" cannot be in the future');

  let report;
  try {
    report = await getReport(from, to);
  } catch (e) {
    if (e instanceof ReportRangeError) return err(e.status, e.publicMessage);
    return safeError(e, 'Could not build Excel.', 'GET /api/admin/reports/range.xlsx');
  }

  try {
    await logAuditOrFail({
      actor: auth.user,
      action: 'export.orders',
      entity_type: 'export',
      entity_label: from === to ? `daily_report_${from}.xlsx` : `report_${from}_to_${to}.xlsx`,
      changes: {
        from, to,
        format: 'xlsx',
        row_count: report.items.length,
        categories: report.categories.length,
        total_revenue: report.total_revenue,
      },
    });
  } catch (e) {
    return safeError(e, 'Could not run export.', 'GET /api/admin/reports/range.xlsx');
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Overview ─────────────────────────────────────
  const isSingle = report.is_single_day;
  const overview: XLSX.CellObject[][] = [
    [cell('Chaudhary Farm — Sales report', { font: { bold: true, sz: 16 }, alignment: { horizontal: 'left' } })],
    [],
    [cell('Period',       headerStyle), cell(isSingle ? from : `${from} to ${to}`, textStyle)],
    [cell('Days',         headerStyle), cell(report.daily_totals.length, intStyle)],
    [cell('Total revenue',headerStyle), cell(report.total_revenue, { ...moneyStyle, font: { bold: true, sz: 13 } })],
    [cell('Total orders', headerStyle), cell(report.total_orders, intStyle)],
    [cell('Items sold',   headerStyle), cell(report.total_items, qtyStyle)],
    [cell('vs prior',     headerStyle), cell(
      report.prev_revenue > 0
        ? `${formatDelta(report.total_revenue - report.prev_revenue)} (${(((report.total_revenue - report.prev_revenue) / report.prev_revenue) * 100).toFixed(1)}%) ${report.prev_label}`
        : `${report.prev_label}: $0.00`,
      textStyle,
    )],
  ];
  const ovSheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(ovSheet, overview.map((r) => r.length ? r : ['']), { origin: 'A1' });
  // Manual cell injection for styles (aoa_to_sheet strips styles on plain values).
  overview.forEach((row, ri) => {
    row.forEach((c, ci) => {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      (ovSheet as any)[addr] = c;
    });
  });
  ovSheet['!cols'] = [{ wch: 22 }, { wch: 42 }];
  ovSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, ovSheet, 'Overview');

  // ── Sheet 2: By Category ──────────────────────────────────
  const catHeader = [
    cell('',         headerStyle),
    cell('Category', headerStyle),
    cell('Revenue',  headerStyle),
    cell('Quantity', headerStyle),
    cell('Items',    headerStyle),
    cell('Share',    headerStyle),
  ];
  const catRows: XLSX.CellObject[][] = [catHeader];
  for (const c of report.categories) {
    const pct = report.total_revenue > 0 ? c.revenue / report.total_revenue : 0;
    const sty = categoryStyle(c.color);
    catRows.push([
      swatch(c.color),
      cell(c.name, sty),
      cell(c.revenue, { ...moneyStyle, font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: sty.fill as any }),
      cell(c.quantity, { ...qtyStyle, font: { color: { rgb: 'FFFFFF' } }, fill: sty.fill as any }),
      cell(c.item_count, { ...intStyle, font: { color: { rgb: 'FFFFFF' } }, fill: sty.fill as any }),
      cell(pct, { ...pctStyle, font: { color: { rgb: 'FFFFFF' } }, fill: sty.fill as any }),
    ]);
  }
  // Grand-total row
  catRows.push([
    cell('', { ...totalStyle }),
    cell('TOTAL', totalStyle),
    cell(report.total_revenue, { ...moneyStyle, ...totalStyle, numFmt: '"$"#,##0.00' }),
    cell(report.total_items,   { ...qtyStyle,   ...totalStyle, numFmt: '#,##0.###' }),
    cell(report.categories.reduce((s, c) => s + c.item_count, 0), { ...intStyle, ...totalStyle, numFmt: '#,##0' }),
    cell(1, { ...pctStyle, ...totalStyle, numFmt: '0.0%' }),
  ]);
  const catSheet = XLSX.utils.aoa_to_sheet([]);
  catRows.forEach((row, ri) => row.forEach((c, ci) => {
    (catSheet as any)[XLSX.utils.encode_cell({ r: ri, c: ci })] = c;
  }));
  catSheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: catRows.length - 1, c: 5 },
  });
  catSheet['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 10 }];
  catSheet['!rows'] = catRows.map(() => ({ hpx: 22 }));
  XLSX.utils.book_append_sheet(wb, catSheet, 'By Category');

  // ── Sheet 3: Items ────────────────────────────────────────
  const itemHeader = [
    cell('Category', headerStyle),
    cell('Item',     headerStyle),
    cell('Revenue',  headerStyle),
    cell('Quantity', headerStyle),
    cell('Orders',   headerStyle),
    cell('Share',    headerStyle),
    cell('Spellings merged', headerStyle),
  ];
  const itemRows: XLSX.CellObject[][] = [itemHeader];
  // Group: categories in sort order, items by revenue desc within each.
  const itemsByCat = new Map<string | null, typeof report.items>();
  for (const it of report.items) {
    const k = it.category_id ?? null;
    const arr = itemsByCat.get(k) ?? [];
    arr.push(it);
    itemsByCat.set(k, arr);
  }
  for (const cat of report.categories) {
    const k = cat.id ?? null;
    const items = (itemsByCat.get(k) ?? []).slice().sort((a, b) => b.revenue - a.revenue);
    for (const it of items) {
      const pct = report.total_revenue > 0 ? it.revenue / report.total_revenue : 0;
      itemRows.push([
        cell(cat.name,          { ...textStyle, fill: { patternType: 'solid', fgColor: { rgb: hexNoHash(cat.color) } }, font: { color: { rgb: 'FFFFFF' }, bold: true } }),
        cell(it.display_name,   textStyle),
        cell(it.revenue,        moneyStyle),
        cell(it.quantity,       qtyStyle),
        cell(it.order_count,    intStyle),
        cell(pct,               pctStyle),
        cell(it.merged_from.join(' | '), textStyle),
      ]);
    }
  }
  const itemSheet = XLSX.utils.aoa_to_sheet([]);
  itemRows.forEach((row, ri) => row.forEach((c, ci) => {
    (itemSheet as any)[XLSX.utils.encode_cell({ r: ri, c: ci })] = c;
  }));
  itemSheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: itemRows.length - 1, c: 6 },
  });
  itemSheet['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, itemSheet, 'Items');

  // ── Sheet 4: Daily (only for multi-day ranges) ────────────
  if (!isSingle && report.daily_totals.length > 1) {
    const dHeader = [
      cell('Date',    headerStyle),
      cell('Revenue', headerStyle),
      cell('Orders',  headerStyle),
    ];
    const dRows: XLSX.CellObject[][] = [dHeader];
    for (const d of report.daily_totals) {
      dRows.push([
        cell(d.date,    textStyle),
        cell(d.revenue, moneyStyle),
        cell(d.orders,  intStyle),
      ]);
    }
    const dSheet = XLSX.utils.aoa_to_sheet([]);
    dRows.forEach((row, ri) => row.forEach((c, ci) => {
      (dSheet as any)[XLSX.utils.encode_cell({ r: ri, c: ci })] = c;
    }));
    dSheet['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 }, e: { r: dRows.length - 1, c: 2 },
    });
    dSheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, dSheet, 'Daily');
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const filename = isSingle ? `daily_report_${from}.xlsx` : `report_${from}_to_${to}.xlsx`;

  return new Response(buf as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentHeader(filename),
      'Cache-Control': 'no-store',
    },
  });
}

function hexNoHash(hex: string): string {
  return (hex.startsWith('#') ? hex.slice(1) : hex).toUpperCase().padStart(6, '0').slice(0, 6);
}

function formatDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
