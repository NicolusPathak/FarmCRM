'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Download, Loader2, TrendingUp, TrendingDown, Minus,
  Receipt, Package, DollarSign, FileSpreadsheet,
  PieChart as PieIcon,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type {
  ReportCategoryRow,
  ReportData,
  ReportItemRow,
} from '@/types';

interface Props {
  initialReport: ReportData;
  initialFrom: string;
  initialTo: string;
  today: string;
}

interface Preset { label: string; build: (today: string) => { from: string; to: string } }

// Quick presets — order matters; "Custom" isn't here because it just
// means the user picks from/to manually.
const PRESETS: Preset[] = [
  { label: 'Today',       build: t => ({ from: t,           to: t }) },
  { label: 'Yesterday',   build: t => { const y = shift(t, -1); return { from: y, to: y }; } },
  { label: 'This week',   build: t => ({ from: startOfWeekMon(t), to: t }) },
  { label: 'Last 7 days', build: t => ({ from: shift(t, -6),  to: t }) },
  { label: 'Last 14 days',build: t => ({ from: shift(t, -13), to: t }) },
  { label: 'This month',  build: t => ({ from: monthStart(t), to: t }) },
  { label: 'Last 30 days',build: t => ({ from: shift(t, -29), to: t }) },
  { label: 'Last month',  build: t => lastMonthRange(t) },
];

export default function ReportClient({
  initialReport, initialFrom, initialTo, today,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from,   setFrom]   = useState(initialFrom);
  const [to,     setTo]     = useState(initialTo);
  const [report, setReport] = useState<ReportData>(initialReport);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<null | 'csv' | 'xlsx'>(null);
  const [showDetailPie, setShowDetailPie] = useState(false);
  const [, startTransition] = useTransition();

  // Sync state when the URL changes (e.g. browser back/forward).
  useEffect(() => {
    const f = searchParams.get('from') ?? today;
    const t = searchParams.get('to')   ?? f;
    if (f !== from || t !== to) { setFrom(f); setTo(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load(nextFrom: string, nextTo: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/range?from=${nextFrom}&to=${nextTo}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load report');
      setReport(await res.json());
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function apply(nextFrom: string, nextTo: string) {
    if (nextFrom > nextTo) { toast.error('"From" must be on or before "To".'); return; }
    if (nextTo > today)    { toast.error('"To" cannot be in the future.'); return; }
    setFrom(nextFrom); setTo(nextTo);
    // Push the URL so the range is bookmarkable / shareable.
    startTransition(() => {
      const params = new URLSearchParams();
      params.set('from', nextFrom);
      if (nextTo !== nextFrom) params.set('to', nextTo);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
    load(nextFrom, nextTo);
  }

  // Find which preset (if any) matches the current selection.
  const activePresetLabel = useMemo(() => {
    for (const p of PRESETS) {
      const r = p.build(today);
      if (r.from === from && r.to === to) return p.label;
    }
    return null;
  }, [from, to, today]);

  async function downloadReport(format: 'csv' | 'xlsx') {
    if (downloading) return;
    setDownloading(format);
    try {
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const res = await fetch(`/api/admin/reports/range.${ext}?from=${from}&to=${to}`, { cache: 'no-store' });
      if (!res.ok) {
        const ct = res.headers.get('Content-Type') ?? '';
        let msg = `Export failed (${res.status}).`;
        if (ct.includes('application/json')) {
          try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        }
        toast.error(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = from === to ? `daily_report_${from}.${ext}` : `report_${from}_to_${to}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Downloaded ${format.toUpperCase()}`);
    } catch (err: any) {
      toast.error(err.message ?? 'Could not download');
    } finally {
      setDownloading(null);
    }
  }

  const delta    = report.total_revenue - report.prev_revenue;
  const deltaPct = report.prev_revenue > 0
    ? (delta / report.prev_revenue) * 100
    : (report.total_revenue > 0 ? 100 : 0);

  const grandRevenue = report.total_revenue || 0;
  const topRevenueRow = report.items[0]?.revenue ?? 0;
  const showSparklines = report.is_single_day && report.trend_by_item.length > 0;
  const showDailyChart = !report.is_single_day && report.daily_totals.length > 1;

  const rangeLabel = report.is_single_day
    ? prettyDate(from)
    : `${prettyDate(from)} — ${prettyDate(to)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Preset chips */}
      <div className="report-presets">
        {PRESETS.map(p => {
          const r = p.build(today);
          const active = activePresetLabel === p.label;
          const disabled = r.to > today;
          return (
            <button
              key={p.label}
              onClick={() => apply(r.from, r.to)}
              disabled={loading || disabled}
              className={`report-preset${active ? ' is-active' : ''}`}
              type="button"
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Custom range controls */}
      <div className="report-controls">
        <label>
          <span style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>From</span>
          <input
            type="date"
            className="input-field"
            value={from}
            max={to}
            onChange={(e) => apply(e.target.value, to)}
            disabled={loading}
          />
        </label>
        <label>
          <span style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>To</span>
          <input
            type="date"
            className="input-field"
            value={to}
            min={from}
            max={today}
            onChange={(e) => apply(from, e.target.value)}
            disabled={loading}
          />
        </label>
        <button
          className="btn-primary"
          onClick={() => downloadReport('xlsx')}
          disabled={downloading !== null || loading || report.items.length === 0}
          title="Multi-sheet Excel with category colors, totals, and details"
        >
          {downloading === 'xlsx'
            ? <><Loader2 size={14} className="spin" /> Excel…</>
            : <><FileSpreadsheet size={14} /> Download Excel</>}
        </button>
        <button
          className="btn-secondary"
          onClick={() => downloadReport('csv')}
          disabled={downloading !== null || loading || report.items.length === 0}
        >
          {downloading === 'csv'
            ? <><Loader2 size={14} className="spin" /> CSV…</>
            : <><Download size={14} /> CSV</>}
        </button>
        {loading && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-muted)' }}>
            <Loader2 size={12} className="spin" /> loading…
          </span>
        )}
      </div>

      {/* Active-period label */}
      <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
        Showing <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{rangeLabel}</span>
        {!report.is_single_day && ` · ${report.daily_totals.length} days`}
      </div>

      {/* KPI row */}
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}>
        <KpiCard
          Icon={DollarSign}
          label="Revenue"
          value={formatCurrency(report.total_revenue)}
          delta={delta}
          deltaPct={deltaPct}
          deltaPrefix={report.prev_label}
        />
        <KpiCard
          Icon={Receipt}
          label="Orders"
          value={String(report.total_orders)}
          delta={report.total_orders - report.prev_orders}
          subline={`${report.prev_orders} ${report.prev_label.replace('vs ', '')}`}
        />
        <KpiCard
          Icon={Package}
          label="Items sold"
          value={fmtQty(report.total_items)}
          subline={!report.is_single_day
            ? `${formatCurrency(report.total_revenue / Math.max(1, report.daily_totals.length))} / day avg`
            : undefined}
        />
      </div>

      {/* Empty state */}
      {report.items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--ink-muted)' }}>
          No active sales for {rangeLabel}.
        </div>
      ) : (
        <>
          {/* Pie chart of category revenue — the headline visual */}
          <div className="card pie-card">
            <SectionHeader
              title="Share of revenue"
              subtitle="Each category as a slice of the period total."
            />
            <CategoryPie
              categories={report.categories}
              total={grandRevenue}
              onShowDetail={() => setShowDetailPie(true)}
            />
          </div>

          {showDetailPie && (
            <DetailPieModal
              items={report.items}
              categories={report.categories}
              total={grandRevenue}
              rangeLabel={rangeLabel}
              onClose={() => setShowDetailPie(false)}
            />
          )}

          {/* Category tiles */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <SectionHeader title="By category" padded />
            <div className="report-cat-grid">
              {report.categories.map(c => (
                <CategoryTile key={c.id ?? 'uncat'} cat={c} total={grandRevenue} />
              ))}
            </div>
          </div>

          {/* Range: daily revenue bar chart */}
          {showDailyChart && (
            <div className="card">
              <SectionHeader
                title="Daily revenue"
                subtitle={`Total per day across the ${report.daily_totals.length}-day period.`}
              />
              <DailyBarChart daily={report.daily_totals} />
            </div>
          )}

          {/* Single-day: sparklines for top items */}
          {showSparklines && (
            <div className="card">
              <SectionHeader title="7-day trend" subtitle="Top sellers — each line is daily revenue for the past week." />
              <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 4 }}>
                {report.trend_by_item.map(t => (
                  <Sparkline
                    key={t.normalized_name}
                    title={t.display_name}
                    color={t.category_color ?? '#94a3b8'}
                    values={t.daily_revenue}
                    labels={report.trend_dates}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ranked items */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <SectionHeader title="Every item, ranked" padded
              subtitle={`${report.items.length} item${report.items.length === 1 ? '' : 's'} sold`} />
            <div style={{ borderTop: '1px solid var(--border-soft)' }}>
              {report.items.map(it => (
                <ItemRow key={it.normalized_name} item={it} topRevenue={topRevenueRow} />
              ))}
            </div>
          </div>

          {/* "Other" callout — lightweight informational. Legacy line
              items entered before the product catalog will land here.
              Since every NEW order is catalog-locked, this should drift
              toward zero over time without any admin action. */}
          {report.uncategorized_count > 0 && (
            <div className="card other-callout">
              <SectionHeader
                title={`${report.uncategorized_count} item${report.uncategorized_count === 1 ? '' : 's'} in “Other”`}
                subtitle="Older free-text entries that don't match a catalog product. New orders always bucket correctly."
              />
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <style jsx global>{`
        /* Preset chips — wrap on narrow screens. */
        .report-presets {
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .report-preset {
          padding: 7px 12px; font-size: 12.5px; font-weight: 500;
          border-radius: 999px; border: 1px solid var(--border);
          background: var(--surface); color: var(--ink);
          font-family: inherit; cursor: pointer;
          transition: background 120ms, border-color 120ms;
        }
        .report-preset:hover:not(:disabled) { background: var(--surface-2); }
        .report-preset.is-active {
          background: var(--ink); color: var(--surface);
          border-color: var(--ink);
        }
        .report-preset:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Custom from/to + download button. Stacks on mobile. */
        .report-controls {
          display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px;
        }
        .report-controls label {
          display: inline-flex; flex-direction: column; gap: 4px; font-size: 13px;
        }
        .report-controls .input-field {
          width: 170px; padding: 8px 10px;
        }
        @media (max-width: 520px) {
          .report-controls { gap: 8px; }
          .report-controls label { flex: 1 1 calc(50% - 4px); min-width: 0; }
          .report-controls .input-field { width: 100%; }
          .report-controls .btn-primary { width: 100%; }
        }

        /* Category tiles — hairline grid via 1px gap with bordered parent. */
        .report-cat-grid {
          display: grid; gap: 1px; background: var(--border-soft);
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          border-top: 1px solid var(--border-soft);
        }
        .report-cat-tile { background: var(--surface); padding: 14px 16px; }

        /* Item rows: stack the money column below the name on small screens. */
        .report-item-row {
          display: grid;
          grid-template-columns: 8px 1fr auto;
          gap: 12px; align-items: center;
          padding: 12px 18px; border-bottom: 1px solid var(--border-soft);
        }
        .report-item-row__bar { width: 8px; height: 24px; border-radius: 3px; }
        .report-item-row__body { min-width: 0; }
        .report-item-row__head {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .report-item-row__right { text-align: right; min-width: 110px; }
        @media (max-width: 520px) {
          .report-item-row {
            grid-template-columns: 8px 1fr;
            grid-template-areas: 'bar body' '. right';
            padding: 12px 14px;
          }
          .report-item-row__bar   { grid-area: bar; align-self: start; margin-top: 4px; }
          .report-item-row__body  { grid-area: body; }
          .report-item-row__right {
            grid-area: right; text-align: left;
            display: flex; gap: 10px; align-items: baseline; min-width: 0;
          }
          .report-item-row__right > div:last-child { margin-top: 0 !important; }
        }

        /* ─── "Other" callout (informational; legacy items only) ── */
        .other-callout {
          border-color: var(--border);
          background: var(--surface-2);
        }

        /* ─── Pie chart ──────────────────────────────────────── */
        .pie-card { padding: 22px; }
        .pie-wrap {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 32px;
          align-items: center;
        }
        .pie-wrap--tall { align-items: start; gap: 28px; }
        .donut { flex-shrink: 0; }
        .pie-side {
          display: flex; flex-direction: column;
          gap: 14px; min-width: 0;
        }
        .pie-legend {
          display: flex; flex-direction: column;
          background: var(--surface-2);
          border: 1px solid var(--border-soft);
          border-radius: 14px;
          overflow: hidden;
        }
        .pie-legend__row {
          display: grid;
          grid-template-columns: 14px 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 12px 14px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-soft);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: background 120ms;
        }
        .pie-legend__row:last-child { border-bottom: none; }
        .pie-legend__row:hover,
        .pie-legend__row.is-active { background: var(--surface); }
        .pie-legend__swatch {
          width: 12px; height: 12px;
          border-radius: 4px;
          background: var(--slice);
          box-shadow: 0 0 0 2px rgba(255,255,255,0.6) inset, 0 1px 2px rgba(0,0,0,0.1);
        }
        .pie-legend__main {
          display: flex; flex-direction: column; gap: 2px; min-width: 0;
        }
        .pie-legend__name {
          font-size: 13.5px; font-weight: 600;
          color: var(--ink);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pie-legend__meta {
          font-size: 11.5px; color: var(--ink-muted);
        }
        .pie-legend__money {
          text-align: right;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .pie-legend__value {
          font-size: 13.5px; font-weight: 700; color: var(--ink);
        }
        .pie-legend__pct {
          font-size: 11.5px; color: var(--ink-muted); margin-top: 1px;
        }
        .detail-btn {
          align-self: flex-start;
          padding: 10px 14px;
        }

        @media (max-width: 767px) {
          .pie-wrap { grid-template-columns: 1fr; justify-items: center; gap: 18px; }
          .pie-side { width: 100%; }
        }

        /* ─── Detail modal ───────────────────────────────────── */
        .detail-backdrop {
          position: fixed; inset: 0;
          background: rgba(20,17,15,0.50);
          backdrop-filter: blur(4px);
          z-index: 100;
          display: flex; align-items: flex-start; justify-content: center;
          padding: 32px 16px;
          overflow-y: auto;
          animation: dpFade 160ms ease-out;
        }
        @keyframes dpFade { from { opacity: 0; } to { opacity: 1; } }
        .detail-modal {
          background: var(--bg);
          border-radius: 22px;
          width: 100%;
          max-width: 920px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.30), 0 8px 22px rgba(0,0,0,0.10);
          border: 1px solid var(--border);
          overflow: hidden;
          animation: dpPop 220ms cubic-bezier(.2,.7,.2,1);
        }
        @keyframes dpPop { from { transform: translateY(12px); } to { transform: none; } }
        .detail-modal__head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 16px;
          padding: 22px 26px;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
        }
        .detail-modal__eyebrow {
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.1em;
          color: var(--ink-muted);
        }
        .detail-modal__title {
          font-size: 26px;
          letter-spacing: -0.01em;
          color: var(--ink);
          margin-top: 4px;
        }
        .detail-modal__subtitle {
          font-size: 13px; color: var(--ink-muted);
          margin-top: 4px;
        }
        .detail-modal__close {
          width: 36px; height: 36px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink-2);
          font-size: 22px; line-height: 1;
          cursor: pointer;
          transition: all 120ms;
        }
        .detail-modal__close:hover {
          background: var(--ink); color: var(--bg); border-color: var(--ink);
        }
        .detail-modal__body {
          padding: 22px 26px 26px;
          display: flex; flex-direction: column;
          gap: 28px;
        }
        .detail-section {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 20px 22px;
        }

        /* Per-category chips inside the modal */
        .cat-chips {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .cat-chip {
          display: grid;
          grid-template-columns: 4px 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 12px 12px 12px 0;
          background: var(--surface-2);
          border: 1px solid var(--border-soft);
          border-radius: 12px;
          overflow: hidden;
        }
        .cat-chip__bar {
          width: 4px; align-self: stretch;
          background: var(--chip);
        }
        .cat-chip__name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
        .cat-chip__money {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13.5px; font-weight: 700; color: var(--ink);
        }
        .cat-chip__pct {
          grid-column: 2 / 4;
          font-size: 11.5px; color: var(--ink-muted);
        }

        @media (max-width: 600px) {
          .detail-modal__head { padding: 18px 18px; }
          .detail-modal__body { padding: 18px; gap: 18px; }
          .detail-modal__title { font-size: 22px; }
          .detail-section { padding: 16px; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, Icon, padded }: {
  title: string; subtitle?: string;
  Icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  padded?: boolean;
}) {
  return (
    <div style={{ padding: padded ? '14px 18px' : 0, marginBottom: padded ? 0 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={15} strokeWidth={1.8} />}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h3>
      </div>
      {subtitle && (
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-muted)' }}>{subtitle}</p>
      )}
    </div>
  );
}

function KpiCard({ Icon, label, value, delta, deltaPct, deltaPrefix, subline }: {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  value: string;
  delta?: number;
  deltaPct?: number;
  deltaPrefix?: string;
  subline?: string;
}) {
  const hasDelta = typeof delta === 'number';
  const up   = hasDelta && delta! > 0;
  const down = hasDelta && delta! < 0;
  const color = up ? 'var(--success, #16a34a)' : down ? 'var(--danger, #b91c1c)' : 'var(--ink-muted)';
  const Arrow = up ? TrendingUp : down ? TrendingDown : Minus;

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'var(--ink)',
      }}>
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1, marginTop: 4 }}>
          {value}
        </div>
        {hasDelta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12, color }}>
            <Arrow size={13} strokeWidth={2} />
            {typeof deltaPct === 'number'
              ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% ${deltaPrefix ?? ''}`.trim()
              : `${delta! >= 0 ? '+' : ''}${delta} ${deltaPrefix ?? ''}`.trim()}
          </div>
        )}
        {subline && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: hasDelta ? 2 : 4 }}>
            {subline}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pie chart
// ─────────────────────────────────────────────────────────────

interface PieSlice {
  key: string;
  name: string;
  color: string;
  revenue: number;
  pct: number;
  meta?: string;
}

// Convert a hex color to a darker shade for the gradient. Used by the donut
// arcs to add depth without picking a second color per slice.
function shadeHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  r = f(r); g = f(g); b = f(b);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// Donut arc path — handles the 100%-single-slice edge case by drawing it
// as two arcs that meet on the opposite side of the circle.
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (sweep <= 0) return '';
  // Single 100% slice: split into two arcs so we don't hit the SVG arc
  // singularity at start === end.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const aMid = a0 + Math.PI;
    return arcPath(cx, cy, r0, r1, a0, aMid - 1e-3) + ' ' + arcPath(cx, cy, r0, r1, aMid, a0 + Math.PI * 2 - 1e-3);
  }
  const large = sweep > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, r1, a0);
  const p1 = polar(cx, cy, r1, a1);
  const p2 = polar(cx, cy, r0, a1);
  const p3 = polar(cx, cy, r0, a0);
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r1} ${r1} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} A ${r0} ${r0} 0 ${large} 0 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} Z`;
}

// SVG donut chart with hover-highlight. `slices` are pre-sorted; the chart
// draws them clockwise starting at 12 o'clock. `centerLabel`/`centerValue`
// fill the donut hole; when a slice is hovered they swap in to show that
// slice's name + revenue.
function DonutChart({
  slices,
  active,
  setActive,
  centerLabel,
  centerValue,
  size = 280,
}: {
  slices: PieSlice[];
  active: string | null;
  setActive: (k: string | null) => void;
  centerLabel: string;
  centerValue: string;
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const r1 = size / 2 - 6;            // outer radius
  const r0 = r1 * 0.62;               // inner radius (donut hole)

  // Accumulate angles via reduce — pure, no mutation across renders.
  // Each slice starts where the previous one ended; the first starts at
  // -PI/2 (12 o'clock) so the donut reads clockwise from the top.
  const slicesWithGeom = slices.reduce<{ s: PieSlice; a0: number; a1: number }[]>((acc, s) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].a1 : -Math.PI / 2;
    const span = (s.pct / 100) * Math.PI * 2;
    acc.push({ s, a0: prev, a1: prev + span });
    return acc;
  }, []);

  // Active slice gets a tiny outward shift for a "pull" effect.
  const activeSlice = slicesWithGeom.find((x) => x.s.key === active);

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Category revenue chart">
        <defs>
          {slicesWithGeom.map(({ s }) => (
            <linearGradient id={`g-${s.key}`} key={s.key} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={shadeHex(s.color, 0.18)} />
              <stop offset="100%" stopColor={shadeHex(s.color, -0.18)} />
            </linearGradient>
          ))}
        </defs>
        {slicesWithGeom.map(({ s, a0, a1 }) => {
          const isActive = active === s.key;
          // "pull" effect: translate the active slice slightly outward along its
          // mid-angle. Cheap visual cue, no layout reflow.
          const aMid = (a0 + a1) / 2;
          const tx = isActive ? Math.cos(aMid) * 6 : 0;
          const ty = isActive ? Math.sin(aMid) * 6 : 0;
          const fade = active && !isActive ? 0.32 : 1;
          return (
            <g
              key={s.key}
              transform={`translate(${tx} ${ty})`}
              style={{ opacity: fade, transition: 'opacity 140ms, transform 160ms ease' }}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              tabIndex={0}
            >
              <title>{`${s.name} · ${formatCurrency(s.revenue)} (${s.pct.toFixed(1)}%)`}</title>
              <path
                d={arcPath(cx, cy, r0, r1, a0, a1)}
                fill={`url(#g-${s.key})`}
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: 'pointer' }}
              />
            </g>
          );
        })}
        {/* Center label */}
        <g pointerEvents="none">
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize="11" fontWeight="700"
                letterSpacing="0.08em" fill="var(--ink-muted)" style={{ textTransform: 'uppercase' }}>
            {activeSlice ? activeSlice.s.name : centerLabel}
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="22" fontWeight="700"
                letterSpacing="-0.02em" fill="var(--ink)">
            {activeSlice ? formatCurrency(activeSlice.s.revenue) : centerValue}
          </text>
          {activeSlice && (
            <text x={cx} y={cy + 38} textAnchor="middle" fontSize="11" fill="var(--ink-muted)"
                  fontFamily="ui-monospace, SFMono-Regular, monospace">
              {activeSlice.s.pct.toFixed(1)}%
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}

// Right-side legend for the donut. Each row tints background on hover and
// keeps the donut's `active` state in sync.
function PieLegend({
  slices, active, setActive,
}: {
  slices: PieSlice[];
  active: string | null;
  setActive: (k: string | null) => void;
}) {
  return (
    <div className="pie-legend">
      {slices.map((s) => {
        const isActive = active === s.key;
        return (
          <button
            type="button"
            key={s.key}
            className={`pie-legend__row${isActive ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.key)}
            onBlur={() => setActive(null)}
            style={{ ['--slice' as string]: s.color }}
          >
            <span className="pie-legend__swatch" />
            <div className="pie-legend__main">
              <span className="pie-legend__name">{s.name}</span>
              {s.meta && <span className="pie-legend__meta">{s.meta}</span>}
            </div>
            <div className="pie-legend__money">
              <div className="pie-legend__value">{formatCurrency(s.revenue)}</div>
              <div className="pie-legend__pct">{s.pct.toFixed(1)}%</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CategoryPie({
  categories, total, onShowDetail,
}: {
  categories: ReportCategoryRow[];
  total: number;
  onShowDetail: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const slices: PieSlice[] = useMemo(() => {
    const positive = categories.filter((c) => c.revenue > 0);
    return positive.map((c) => ({
      key: c.id ?? 'uncat',
      name: c.name,
      color: c.color,
      revenue: c.revenue,
      pct: total > 0 ? (c.revenue / total) * 100 : 0,
      meta: `${fmtQty(c.quantity)} units · ${c.item_count} item${c.item_count === 1 ? '' : 's'}`,
    }));
  }, [categories, total]);

  if (total <= 0 || slices.length === 0) {
    return <div style={{ color: 'var(--ink-muted)', fontSize: 13, padding: '20px 0' }}>No revenue to chart for this period.</div>;
  }

  return (
    <div className="pie-wrap">
      <DonutChart
        slices={slices}
        active={active}
        setActive={setActive}
        centerLabel="Total revenue"
        centerValue={formatCurrency(total)}
      />
      <div className="pie-side">
        <PieLegend slices={slices} active={active} setActive={setActive} />
        <button type="button" className="btn-secondary detail-btn" onClick={onShowDetail}>
          <PieIcon size={14} /> View detail report
        </button>
      </div>
    </div>
  );
}

// Modal: item-level pie. Top 8 items get their own slice colored by their
// category; the rest are bucketed into "Other".
function DetailPieModal({
  items, categories, total, rangeLabel, onClose,
}: {
  items: ReportItemRow[];
  categories: ReportCategoryRow[];
  total: number;
  rangeLabel: string;
  onClose: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  // ESC to close, lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const TOP_N = 8;
  const slices: PieSlice[] = useMemo(() => {
    const ranked = [...items].filter((i) => i.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const top = ranked.slice(0, TOP_N);
    const rest = ranked.slice(TOP_N);
    const restRev = rest.reduce((s, x) => s + x.revenue, 0);
    const out: PieSlice[] = top.map((it, i) => ({
      key: `${it.normalized_name}-${i}`,
      name: it.display_name,
      color: it.category_color ?? '#94a3b8',
      revenue: it.revenue,
      pct: total > 0 ? (it.revenue / total) * 100 : 0,
      meta: `${it.category_name ?? 'Uncategorized'} · ${fmtQty(it.quantity)} units`,
    }));
    if (restRev > 0) {
      out.push({
        key: 'other',
        name: `Other (${rest.length})`,
        color: '#9CA3AF',
        revenue: restRev,
        pct: total > 0 ? (restRev / total) * 100 : 0,
        meta: `${rest.length} items combined`,
      });
    }
    return out;
  }, [items, total]);

  // Category pie (small) — shown alongside the item pie for context.
  const catSlices: PieSlice[] = useMemo(() => {
    return categories
      .filter((c) => c.revenue > 0)
      .map((c) => ({
        key: c.id ?? 'uncat',
        name: c.name,
        color: c.color,
        revenue: c.revenue,
        pct: total > 0 ? (c.revenue / total) * 100 : 0,
      }));
  }, [categories, total]);

  return (
    <div className="detail-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-modal__head">
          <div>
            <div className="detail-modal__eyebrow">Detail report</div>
            <h2 className="font-display detail-modal__title">{rangeLabel}</h2>
            <div className="detail-modal__subtitle">
              {formatCurrency(total)} across {items.length} item{items.length === 1 ? '' : 's'}
            </div>
          </div>
          <button type="button" className="detail-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="detail-modal__body">
          <section className="detail-section">
            <SectionHeader
              title="Items · top 8 + the rest"
              subtitle="Each slice is one item, colored by category. Hover for the exact amount."
            />
            <div className="pie-wrap pie-wrap--tall">
              <DonutChart
                slices={slices}
                active={active}
                setActive={setActive}
                centerLabel="Total revenue"
                centerValue={formatCurrency(total)}
                size={320}
              />
              <div className="pie-side">
                <PieLegend slices={slices} active={active} setActive={setActive} />
              </div>
            </div>
          </section>

          {catSlices.length > 0 && (
            <section className="detail-section">
              <SectionHeader title="By category" subtitle="The same total, sliced by category." />
              <div className="cat-chips">
                {catSlices.map((c) => (
                  <div key={c.key} className="cat-chip" style={{ ['--chip' as string]: c.color }}>
                    <span className="cat-chip__bar" />
                    <span className="cat-chip__name">{c.name}</span>
                    <span className="cat-chip__money">{formatCurrency(c.revenue)}</span>
                    <span className="cat-chip__pct">{c.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryTile({ cat, total }: { cat: ReportCategoryRow; total: number }) {
  const pct = total > 0 ? (cat.revenue / total) * 100 : 0;
  return (
    <div className="report-cat-tile">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: cat.color }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{cat.name}</span>
      </div>
      <div className="font-display" style={{ fontSize: 22, marginTop: 6 }}>
        {formatCurrency(cat.revenue)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
        {pct.toFixed(0)}% · {fmtQty(cat.quantity)} units · {cat.item_count} item{cat.item_count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function ItemRow({ item, topRevenue }: { item: ReportItemRow; topRevenue: number }) {
  const pct = topRevenue > 0 ? (item.revenue / topRevenue) * 100 : 0;
  const color = item.category_color ?? '#94a3b8';
  return (
    <div className="report-item-row">
      <div className="report-item-row__bar" style={{ background: color }} />
      <div className="report-item-row__body">
        <div className="report-item-row__head">
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{item.display_name}</span>
          {item.category_name && (
            <span style={{
              fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
              background: 'var(--surface-2)', color: 'var(--ink-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
            }}>{item.category_name}</span>
          )}
          {item.merged_from.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
              + {item.merged_from.length} spelling{item.merged_from.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div style={{
          marginTop: 6, height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.max(2, pct)}%`, height: '100%', background: color,
            transition: 'width 240ms',
          }} />
        </div>
      </div>
      <div className="report-item-row__right">
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{formatCurrency(item.revenue)}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>
          {fmtQty(item.quantity)} units · {item.order_count} order{item.order_count === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────

function Sparkline({ title, color, values, labels }: {
  title: string; color: string; values: number[]; labels: string[];
}) {
  const max = Math.max(...values, 1);
  const W = 220, H = 50, P = 4;
  const stepX = values.length > 1 ? (W - P * 2) / (values.length - 1) : 0;
  const pts = useMemo(() =>
    values.map((v, i) => {
      const x = P + i * stepX;
      const y = H - P - ((v / max) * (H - P * 2));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' '),
    [values, max, stepX]);

  const last = values[values.length - 1] ?? 0;
  const prior = values.slice(0, -1).reduce((s, v) => s + v, 0) / Math.max(1, values.length - 1);
  const trendUp = last > prior;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '12px 14px', borderRadius: 10,
      background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
          {trendUp ? '↑' : '↓'} {formatCurrency(last)}
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           role="img" aria-label={`${title} 7-day trend`}>
        <polyline fill="none" stroke={color} strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" points={pts} />
        {values.map((v, i) => {
          const x = P + i * stepX;
          const y = H - P - ((v / max) * (H - P * 2));
          return <circle key={i} cx={x} cy={y} r={1.8} fill={color} />;
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-muted)' }}>
        <span>{shortDay(labels[0])}</span>
        <span>{shortDay(labels[labels.length - 1])}</span>
      </div>
    </div>
  );
}

function DailyBarChart({ daily }: { daily: ReportData['daily_totals'] }) {
  // Responsive vertical bar chart. The SVG uses viewBox so it scales to
  // any container width. We use a fixed virtual width (one slot per day)
  // and let CSS stretch it; preserveAspectRatio='none' would distort
  // bars, so we instead size by # of days and let the parent overflow
  // horizontally on extremely long ranges.
  const max = Math.max(1, ...daily.map(d => d.revenue));
  const total = daily.reduce((s, d) => s + d.revenue, 0);
  const avg = total / Math.max(1, daily.length);
  const best = daily.reduce<typeof daily[number] | null>((b, d) => (!b || d.revenue > b.revenue ? d : b), null);

  // Slot width scales down for longer ranges so 30-day ranges feel
  // tighter than 7-day ranges without becoming illegible.
  const slotW = daily.length <= 14 ? 38 : daily.length <= 31 ? 22 : 12;
  const barW  = Math.max(4, slotW - 6);
  const H = 160, P_TOP = 14, P_BOT = 28;
  const usableH = H - P_TOP - P_BOT;
  const W = Math.max(280, slotW * daily.length);

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <svg
        width={W} height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Daily revenue bar chart"
        style={{ display: 'block', minWidth: '100%' }}
      >
        {/* Avg line */}
        {avg > 0 && (
          <line
            x1={0} x2={W}
            y1={P_TOP + (1 - avg / max) * usableH}
            y2={P_TOP + (1 - avg / max) * usableH}
            stroke="var(--border)" strokeDasharray="3 3" strokeWidth={1}
          />
        )}
        {daily.map((d, i) => {
          const h = (d.revenue / max) * usableH;
          const x = i * slotW + (slotW - barW) / 2;
          const y = P_TOP + (usableH - h);
          const isBest = best && d.date === best.date && best.revenue > 0;
          return (
            <g key={d.date}>
              <title>{`${prettyDate(d.date)} — ${formatCurrency(d.revenue)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`}</title>
              <rect
                x={x} y={y} width={barW} height={Math.max(1, h)}
                rx={2}
                fill={isBest ? 'var(--ink)' : 'var(--ink-2, #475569)'}
                opacity={d.revenue === 0 ? 0.25 : 1}
              />
              {/* Day label — only on every Nth bar when crowded so they don't overlap. */}
              {(daily.length <= 14 || i % Math.ceil(daily.length / 12) === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--ink-muted)"
                >
                  {shortDay(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--ink-muted)' }}>
        <span>Avg: <b style={{ color: 'var(--ink)' }}>{formatCurrency(avg)}</b> / day</span>
        {best && best.revenue > 0 && (
          <span>Best: <b style={{ color: 'var(--ink)' }}>{shortDay(best.date)}</b> ({formatCurrency(best.revenue)})</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Date helpers (shop-TZ-agnostic — operate on YYYY-MM-DD strings)
// ─────────────────────────────────────────────────────────────

function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function startOfWeekMon(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Mon=1..Sun=0 — shift to Mon=0..Sun=6.
  const dow = (dt.getUTCDay() + 6) % 7;
  return shift(ymd, -dow);
}

function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function lastMonthRange(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split('-').map(Number);
  const lastY  = m === 1 ? y - 1 : y;
  const lastM  = m === 1 ? 12    : m - 1;
  const lastMM = String(lastM).padStart(2, '0');
  const from   = `${lastY}-${lastMM}-01`;
  // Last day of that month = day 0 of the next month.
  const last   = new Date(Date.UTC(lastY, lastM, 0));
  const lastD  = String(last.getUTCDate()).padStart(2, '0');
  return { from, to: `${lastY}-${lastMM}-${lastD}` };
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDay(ymd: string | undefined): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtQty(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, '');
}
