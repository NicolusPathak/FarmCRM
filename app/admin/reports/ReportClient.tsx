'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Download, Loader2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Wand2, Receipt, Package, DollarSign,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type {
  CategoryWithAliases,
  ReportCategoryRow,
  ReportData,
  ReportItemRow,
} from '@/types';

interface Props {
  initialReport: ReportData;
  initialCategories: CategoryWithAliases[];
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
  initialReport, initialCategories, initialFrom, initialTo, today,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from,   setFrom]   = useState(initialFrom);
  const [to,     setTo]     = useState(initialTo);
  const [report, setReport] = useState<ReportData>(initialReport);
  const [cats,   setCats]   = useState<CategoryWithAliases[]>(initialCategories);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
      const [reportRes, catsRes] = await Promise.all([
        fetch(`/api/admin/reports/range?from=${nextFrom}&to=${nextTo}`, { cache: 'no-store' }),
        fetch('/api/admin/categories', { cache: 'no-store' }),
      ]);
      if (!reportRes.ok) throw new Error((await reportRes.json()).error ?? 'Failed to load report');
      if (!catsRes.ok)   throw new Error((await catsRes.json()).error ?? 'Failed to load categories');
      setReport(await reportRes.json());
      const cd = await catsRes.json();
      setCats(cd.categories ?? []);
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

  async function downloadCsv() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/reports/range.csv?from=${from}&to=${to}`, { cache: 'no-store' });
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
      a.download = from === to ? `daily_report_${from}.csv` : `report_${from}_to_${to}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success('Downloaded');
    } catch (err: any) {
      toast.error(err.message ?? 'Could not download');
    } finally {
      setDownloading(false);
    }
  }

  async function mapItemToCategory(itemName: string, categoryId: string) {
    try {
      const res = await fetch(`/api/admin/categories/${categoryId}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: itemName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success(`"${itemName}" mapped`);
      await load(from, to);
    } catch (err: any) {
      toast.error(err.message);
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
          onClick={downloadCsv}
          disabled={downloading || loading || report.items.length === 0}
        >
          {downloading ? <><Loader2 size={14} className="spin" /> Downloading…</>
                       : <><Download size={14} /> Download CSV</>}
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
          {/* Stacked share bar */}
          <div className="card">
            <SectionHeader title="Share of revenue" subtitle="Each category as a slice of the period total." />
            <StackedShare categories={report.categories} total={grandRevenue} />
          </div>

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

          {/* Uncategorized — actionable */}
          {report.uncategorized_count > 0 && (
            <div className="card" style={{ borderColor: 'var(--warn, #d97706)' }}>
              <SectionHeader
                Icon={AlertTriangle}
                title="Uncategorized items"
                subtitle="These didn't match any category alias. Map them so they show up in the right bucket from now on."
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {report.items.filter(i => i.category_id === null).map(it => (
                  <UncategorizedRow
                    key={it.normalized_name}
                    item={it}
                    categories={cats}
                    onAssign={(catId) => mapItemToCategory(it.display_name, catId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fuzzy merges — informational */}
          {report.merges.length > 0 && (
            <div className="card">
              <SectionHeader
                Icon={Wand2}
                title="Possibly the same item"
                subtitle="We grouped these together based on spelling. Fix the source spelling in /orders if a merge is wrong."
              />
              <div style={{ fontSize: 13, color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {report.merges.map((m, i) => (
                  <div key={i}>
                    <span style={{ fontWeight: 600 }}>{m.absorbed}</span>
                    <span style={{ color: 'var(--ink-muted)' }}> → grouped with </span>
                    <span style={{ fontWeight: 600 }}>{m.kept}</span>
                  </div>
                ))}
              </div>
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
        <div className="font-display" style={{ fontSize: 26, fontWeight: 400, lineHeight: 1.1, marginTop: 4 }}>
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

function StackedShare({ categories, total }: { categories: ReportCategoryRow[]; total: number }) {
  if (total <= 0) {
    return <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No revenue to chart.</div>;
  }
  return (
    <div>
      <div style={{
        display: 'flex', width: '100%', height: 26, borderRadius: 8, overflow: 'hidden',
        background: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--border-soft)',
      }}>
        {categories.map(c => {
          const pct = total > 0 ? (c.revenue / total) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div
              key={c.id ?? 'uncat'}
              title={`${c.name}: ${formatCurrency(c.revenue)} (${pct.toFixed(1)}%)`}
              style={{ width: `${pct}%`, background: c.color, transition: 'width 200ms' }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        {categories.map(c => {
          const pct = total > 0 ? (c.revenue / total) * 100 : 0;
          return (
            <div key={c.id ?? 'uncat'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color }} />
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: 'var(--ink-muted)' }}>· {formatCurrency(c.revenue)} ({pct.toFixed(0)}%)</span>
            </div>
          );
        })}
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

function UncategorizedRow({ item, categories, onAssign }: {
  item: ReportItemRow;
  categories: CategoryWithAliases[];
  onAssign: (categoryId: string) => void | Promise<void>;
}) {
  const [pick, setPick] = useState<string>('');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8,
    }}>
      <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{item.display_name}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        {formatCurrency(item.revenue)} · {fmtQty(item.quantity)} units
      </span>
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="input-field"
        style={{ padding: '6px 8px', fontSize: 12.5, minWidth: 140 }}
      >
        <option value="">Map to…</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        className="btn-ghost"
        style={{ padding: '6px 10px', fontSize: 12.5 }}
        disabled={!pick}
        onClick={() => { if (pick) onAssign(pick); }}
      >
        Add alias
      </button>
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
