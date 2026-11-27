import React, { useMemo, useState } from 'react';
import type { BranchReport, ReportCategory, ReportStatus } from '../types';
import { formatDateId, formatNumber, formatShortDateId } from '../lib/format';

interface DashboardChartsProps {
  reports: BranchReport[];
  categoryReports: BranchReport[];
  branchReports: BranchReport[];
  showBranchChart: boolean;
  activeDate: string | null;
  activeStatus: 'all' | ReportStatus;
  activeCategory: 'all' | ReportCategory;
  activeBranchId: string;
  onSelectDate: (date: string) => void;
  onSelectStatus: (status: 'all' | ReportStatus) => void;
  onSelectCategory: (category: 'all' | ReportCategory) => void;
  onSelectBranch: (branchId: string) => void;
}

interface DailyPoint {
  date: string;
  reviewed: number;
  underReview: number;
  total: number;
}

interface CategoryPoint {
  category: ReportCategory;
  count: number;
  pct: number;
}

interface BranchPoint {
  branchId: string;
  branchName: string;
  branchCode: string;
  count: number;
  pct: number;
}

export function DashboardCharts({
  reports,
  categoryReports,
  branchReports,
  showBranchChart,
  activeDate,
  activeStatus,
  activeCategory,
  activeBranchId,
  onSelectDate,
  onSelectStatus,
  onSelectCategory,
  onSelectBranch,
}: DashboardChartsProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredStatus, setHoveredStatus] = useState<ReportStatus | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<ReportCategory | null>(null);
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null);

  const dailySeries = useMemo<DailyPoint[]>(() => {
    const byDate = new Map<string, DailyPoint>();
    for (const r of reports) {
      const existing = byDate.get(r.reportDate) ?? {
        date: r.reportDate,
        reviewed: 0,
        underReview: 0,
        total: 0,
      };
      if (r.status === 'Reviewed') {
        existing.reviewed += 1;
      } else {
        existing.underReview += 1;
      }
      existing.total += 1;
      byDate.set(r.reportDate, existing);
    }

    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-10);
  }, [reports]);

  const statusSummary = useMemo(() => {
    let reviewed = 0;
    let underReview = 0;
    let sharing = 0;
    let withPdf = 0;

    for (const r of reports) {
      if (r.status === 'Reviewed') reviewed += 1;
      else underReview += 1;
      if (r.category === 'Sharing Session') {
        sharing += 1;
        if (r.hasAttachment) withPdf += 1;
      }
    }

    const total = reports.length;
    const reviewedPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
    const underReviewPct = total > 0 ? 100 - reviewedPct : 0;
    return { total, reviewed, underReview, reviewedPct, underReviewPct, sharing, withPdf };
  }, [reports]);

  const maxDaily = useMemo(() => {
    const highest = dailySeries.reduce((acc, item) => Math.max(acc, item.total), 0);
    return Math.max(2, highest);
  }, [dailySeries]);

  const categorySeries = useMemo<CategoryPoint[]>(() => {
    const counts = new Map<ReportCategory, number>();
    for (const r of categoryReports) {
      counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    }
    const total = categoryReports.length;
    return Array.from(counts.entries())
      .map(([category, count]) => ({
        category,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.category.localeCompare(b.category)));
  }, [categoryReports]);

  const maxCategoryCount = useMemo(() => {
    return Math.max(1, categorySeries[0]?.count ?? 1);
  }, [categorySeries]);

  const focusedCategoryPoint = useMemo(() => {
    const target = hoveredCategory ?? (activeCategory !== 'all' ? activeCategory : null);
    if (!target) return null;
    return categorySeries.find((c) => c.category === target) ?? null;
  }, [categorySeries, hoveredCategory, activeCategory]);

  const branchSeries = useMemo<BranchPoint[]>(() => {
    if (!showBranchChart) return [];
    const byBranch = new Map<
      string,
      { branchId: string; branchName: string; branchCode: string; count: number }
    >();
    for (const r of branchReports) {
      const existing = byBranch.get(r.branchId) ?? {
        branchId: r.branchId,
        branchName: r.branchName,
        branchCode: r.branchCode,
        count: 0,
      };
      existing.count += 1;
      byBranch.set(r.branchId, existing);
    }
    const total = branchReports.length;
    return Array.from(byBranch.values())
      .map((item) => ({
        ...item,
        pct: total > 0 ? Math.round((item.count / total) * 100) : 0,
      }))
      .sort((a, b) =>
        b.count !== a.count ? b.count - a.count : a.branchName.localeCompare(b.branchName)
      );
  }, [branchReports, showBranchChart]);

  const maxBranchCount = useMemo(() => {
    return Math.max(1, branchSeries[0]?.count ?? 1);
  }, [branchSeries]);

  const focusedBranchPoint = useMemo(() => {
    const target = hoveredBranchId ?? (activeBranchId !== 'all' ? activeBranchId : null);
    if (!target) return null;
    return branchSeries.find((b) => b.branchId === target) ?? null;
  }, [branchSeries, hoveredBranchId, activeBranchId]);

  const hoveredBarInfo = useMemo(() => {
    if (!hoveredDate) return null;
    const idx = dailySeries.findIndex((d) => d.date === hoveredDate);
    if (idx === -1) return null;
    return { point: dailySeries[idx], index: idx };
  }, [dailySeries, hoveredDate]);

  const activePoint = useMemo(() => {
    const targetDate = hoveredDate ?? activeDate;
    if (!targetDate) return null;
    return dailySeries.find((d) => d.date === targetDate) ?? null;
  }, [dailySeries, hoveredDate, activeDate]);

  // Donut SVG math
  const radius = 56;
  const baseStrokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  const reviewedDash =
    statusSummary.total > 0
      ? (statusSummary.reviewed / statusSummary.total) * circumference
      : 0;
  const underReviewDash = Math.max(0, circumference - reviewedDash);

  const focusedDonutStatus: ReportStatus | null =
    hoveredStatus ?? (activeStatus !== 'all' ? activeStatus : null);

  const donutCenterPct =
    focusedDonutStatus === 'Under Review'
      ? statusSummary.underReviewPct
      : statusSummary.reviewedPct;
  const donutCenterLabel =
    focusedDonutStatus === 'Under Review' ? 'Under Review' : 'Reviewed';
  const donutCenterCount =
    focusedDonutStatus === 'Under Review'
      ? statusSummary.underReview
      : statusSummary.reviewed;

  // Bar chart SVG geometry
  const chartHeight = 168;
  const padTop = 14;
  const padBottom = 26;
  const plotHeight = chartHeight - padTop - padBottom;
  const slotWidth = 56;
  const barWidth = 26;
  const svgWidth = Math.max(360, dailySeries.length * slotWidth + 32);

  return (
    <section
      aria-label="Grafik dan diagram laporan"
      className="grid grid-cols-1 lg:grid-cols-12 gap-5"
    >
      {/* Grafik 1: Tren Laporan Harian (Stacked Bar Chart) */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-[#0A172E]">Grafik Laporan Harian</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activePoint ? (
                <span className="text-[#033367] font-medium font-mono tabular-nums">
                  {formatDateId(activePoint.date)} · {activePoint.total} laporan (
                  {activePoint.reviewed} Reviewed, {activePoint.underReview} Under Review)
                </span>
              ) : (
                'Arahkan kursor untuk melihat rincian atau klik batang tanggal untuk memfilter.'
              )}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#033367]" aria-hidden="true" />
              Reviewed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
              Under Review
            </span>
          </div>
        </div>

        {dailySeries.length === 0 ? (
          <div className="flex-1 min-h-[180px] flex items-center justify-center text-xs text-slate-400">
            Belum ada data laporan pada rentang filter saat ini.
          </div>
        ) : (
          <div className="relative mt-4 overflow-x-auto">
            {/* Floating Hover Tooltip */}
            {hoveredBarInfo && (
              <div
                className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md bg-[#0A172E] px-3 py-2 text-[11px] text-white shadow-md whitespace-nowrap transition-all duration-100"
                style={{
                  left: `${Math.min(
                    84,
                    Math.max(
                      16,
                      ((34 + hoveredBarInfo.index * slotWidth + barWidth / 2) / svgWidth) * 100
                    )
                  )}%`,
                }}
              >
                <div className="font-semibold">{formatDateId(hoveredBarInfo.point.date)}</div>
                <div className="mt-0.5 font-mono tabular-nums text-white/80">
                  Total {hoveredBarInfo.point.total} · {hoveredBarInfo.point.reviewed} Reviewed ·{' '}
                  {hoveredBarInfo.point.underReview} Under Review
                </div>
              </div>
            )}

            <svg
              viewBox={`0 0 ${svgWidth} ${chartHeight}`}
              className="w-full min-w-[320px] h-[184px] select-none"
              role="img"
              aria-label="Grafik batang jumlah laporan per tanggal"
            >
              {/* Horizontal Gridlines */}
              {[0, 0.5, 1].map((ratio) => {
                const y = padTop + plotHeight * (1 - ratio);
                const tickVal = Math.round(maxDaily * ratio);
                return (
                  <g key={ratio}>
                    <line
                      x1={26}
                      x2={svgWidth - 8}
                      y1={y}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray={ratio === 0 ? undefined : '3 3'}
                      strokeWidth={1}
                    />
                    <text
                      x={20}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {tickVal}
                    </text>
                  </g>
                );
              })}

              {/* Bars */}
              {dailySeries.map((pt, index) => {
                const groupX = 34 + index * slotWidth;
                const centerX = groupX + barWidth / 2;
                const totalHeight = (pt.total / maxDaily) * plotHeight;
                const reviewedHeight = (pt.reviewed / maxDaily) * plotHeight;
                const underReviewHeight = Math.max(0, totalHeight - reviewedHeight);

                const reviewedY = padTop + plotHeight - reviewedHeight;
                const underReviewY = reviewedY - underReviewHeight;
                const isSelected = activeDate === pt.date;
                const isHovered = hoveredDate === pt.date;

                return (
                  <g
                    key={pt.date}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredDate(pt.date)}
                    onMouseLeave={() => setHoveredDate(null)}
                    onClick={() => onSelectDate(pt.date)}
                  >
                    {/* Clear hover/active column backdrop */}
                    <rect
                      x={groupX - 8}
                      y={padTop - 4}
                      width={barWidth + 16}
                      height={plotHeight + 6}
                      rx={6}
                      fill="#033367"
                      fillOpacity={isSelected ? 0.14 : isHovered ? 0.1 : 0}
                      className="transition-all duration-150"
                    />

                    {/* Under Review Segment (Top) */}
                    {pt.underReview > 0 && (
                      <rect
                        x={groupX}
                        y={underReviewY}
                        width={barWidth}
                        height={Math.max(2, underReviewHeight)}
                        rx={pt.reviewed > 0 ? 0 : 3}
                        fill={isSelected || isHovered ? '#94A3B8' : '#CBD5E1'}
                        className="transition-colors duration-150"
                      />
                    )}

                    {/* Reviewed Segment (Bottom) */}
                    {pt.reviewed > 0 && (
                      <rect
                        x={groupX}
                        y={reviewedY}
                        width={barWidth}
                        height={Math.max(2, reviewedHeight)}
                        rx={pt.underReview > 0 ? 0 : 3}
                        fill={isSelected || isHovered ? '#0A172E' : '#033367'}
                        className="transition-colors duration-150"
                      />
                    )}

                    {/* Value label above bar */}
                    <text
                      x={centerX}
                      y={Math.max(10, underReviewY - 4)}
                      textAnchor="middle"
                      className={`text-[10px] font-mono transition-colors ${
                        isSelected || isHovered
                          ? 'fill-[#033367] font-bold'
                          : 'fill-slate-500'
                      }`}
                    >
                      {pt.total}
                    </text>

                    {/* Date tick label */}
                    <text
                      x={centerX}
                      y={chartHeight - 7}
                      textAnchor="middle"
                      className={`text-[10px] font-mono transition-colors ${
                        isSelected || isHovered
                          ? 'fill-[#033367] font-semibold'
                          : 'fill-slate-500'
                      }`}
                    >
                      {formatShortDateId(pt.date)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>

      {/* Grafik 2: Diagram Proporsi Status Review (Donut Chart) */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-[#0A172E]">Diagram Status Review</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Arahkan atau klik status untuk memfilter daftar laporan.
            </p>
          </div>
          {activeStatus !== 'all' && (
            <button
              type="button"
              onClick={() => onSelectStatus('all')}
              className="text-xs font-medium text-[#033367] hover:underline whitespace-nowrap cursor-pointer"
            >
              Semua
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-center gap-5 my-auto">
          {/* SVG Donut with Interactive Slice Hover */}
          <div className="relative w-36 h-36 shrink-0">
            <svg viewBox="0 0 144 144" className="w-full h-full -rotate-90">
              {/* Under Review Segment */}
              <circle
                cx={72}
                cy={72}
                r={radius}
                fill="none"
                stroke={
                  statusSummary.total === 0
                    ? '#F1F5F9'
                    : focusedDonutStatus === 'Under Review'
                      ? '#94A3B8'
                      : '#CBD5E1'
                }
                strokeWidth={focusedDonutStatus === 'Under Review' ? 17 : baseStrokeWidth}
                strokeDasharray={
                  statusSummary.total > 0
                    ? `${underReviewDash} ${circumference}`
                    : undefined
                }
                strokeDashoffset={statusSummary.total > 0 ? -reviewedDash : 0}
                opacity={focusedDonutStatus === 'Reviewed' ? 0.55 : 1}
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={() => setHoveredStatus('Under Review')}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() =>
                  onSelectStatus(activeStatus === 'Under Review' ? 'all' : 'Under Review')
                }
              />

              {/* Reviewed Segment */}
              {statusSummary.reviewed > 0 && (
                <circle
                  cx={72}
                  cy={72}
                  r={radius}
                  fill="none"
                  stroke={focusedDonutStatus === 'Reviewed' ? '#0A172E' : '#033367'}
                  strokeWidth={focusedDonutStatus === 'Reviewed' ? 17 : baseStrokeWidth}
                  strokeDasharray={`${reviewedDash} ${circumference}`}
                  strokeLinecap="butt"
                  opacity={focusedDonutStatus === 'Under Review' ? 0.55 : 1}
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={() => setHoveredStatus('Reviewed')}
                  onMouseLeave={() => setHoveredStatus(null)}
                  onClick={() =>
                    onSelectStatus(activeStatus === 'Reviewed' ? 'all' : 'Reviewed')
                  }
                />
              )}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
              <span className="text-xl font-semibold font-mono tabular-nums text-[#0A172E]">
                {donutCenterPct}%
              </span>
              <span className="text-[11px] font-medium text-slate-600">{donutCenterLabel}</span>
              <span className="text-[10px] font-mono tabular-nums text-slate-400">
                {formatNumber(donutCenterCount)} laporan
              </span>
            </div>
          </div>

          {/* Clickable Legend & Sharing PDF Summary */}
          <div className="flex-1 w-full space-y-2">
            <button
              type="button"
              onMouseEnter={() => setHoveredStatus('Reviewed')}
              onMouseLeave={() => setHoveredStatus(null)}
              onClick={() =>
                onSelectStatus(activeStatus === 'Reviewed' ? 'all' : 'Reviewed')
              }
              className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs transition-all duration-150 cursor-pointer ${
                activeStatus === 'Reviewed' || hoveredStatus === 'Reviewed'
                  ? 'border-[#033367] bg-[#EBF2FA] text-[#033367]'
                  : 'border-slate-200 hover:border-[#033367] hover:bg-[#EBF2FA] text-[#0A172E]'
              }`}
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#033367]" aria-hidden="true" />
                Reviewed
              </span>
              <span className="font-mono tabular-nums">
                {formatNumber(statusSummary.reviewed)} ({statusSummary.reviewedPct}%)
              </span>
            </button>

            <button
              type="button"
              onMouseEnter={() => setHoveredStatus('Under Review')}
              onMouseLeave={() => setHoveredStatus(null)}
              onClick={() =>
                onSelectStatus(activeStatus === 'Under Review' ? 'all' : 'Under Review')
              }
              className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs transition-all duration-150 cursor-pointer ${
                activeStatus === 'Under Review' || hoveredStatus === 'Under Review'
                  ? 'border-[#033367] bg-[#EBF2FA] text-[#033367]'
                  : 'border-slate-200 hover:border-[#033367] hover:bg-[#EBF2FA] text-[#0A172E]'
              }`}
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-300" aria-hidden="true" />
                Under Review
              </span>
              <span className="font-mono tabular-nums">
                {formatNumber(statusSummary.underReview)} ({statusSummary.underReviewPct}%)
              </span>
            </button>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Sharing Session (PDF)</span>
              <span className="font-mono tabular-nums text-[#0A172E] font-medium">
                {formatNumber(statusSummary.withPdf)} / {formatNumber(statusSummary.sharing)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grafik 3: Peringkat Kategori Kegiatan Terbanyak */}
      <div
        className={`${
          showBranchChart ? 'lg:col-span-6' : 'lg:col-span-12'
        } bg-white border border-slate-200 rounded-lg p-5 flex flex-col`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#0A172E]">Grafik Kategori Kegiatan</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {focusedCategoryPoint ? (
                <span className="text-[#033367] font-medium">
                  {focusedCategoryPoint.category} ·{' '}
                  <span className="font-mono tabular-nums">
                    {formatNumber(focusedCategoryPoint.count)} laporan ({focusedCategoryPoint.pct}%)
                  </span>
                </span>
              ) : (
                'Diurutkan dari kategori terbanyak · Klik batang untuk memfilter'
              )}
            </p>
          </div>

          {activeCategory !== 'all' && (
            <button
              type="button"
              onClick={() => onSelectCategory('all')}
              className="text-xs font-medium text-[#033367] hover:underline whitespace-nowrap cursor-pointer shrink-0"
            >
              Semua Kategori
            </button>
          )}
        </div>

        {categorySeries.length === 0 ? (
          <div className="flex-1 min-h-[160px] flex items-center justify-center text-xs text-slate-400">
            Belum ada data kategori kegiatan pada rentang filter saat ini.
          </div>
        ) : (
          <div className="mt-4 space-y-2 flex-1">
            {categorySeries.map((item, idx) => {
              const isTop = idx === 0;
              const isSelected = activeCategory === item.category;
              const isHovered = hoveredCategory === item.category;
              const barPct = Math.max(4, Math.round((item.count / maxCategoryCount) * 100));

              return (
                <button
                  key={item.category}
                  type="button"
                  aria-pressed={isSelected}
                  onMouseEnter={() => setHoveredCategory(item.category)}
                  onMouseLeave={() => setHoveredCategory(null)}
                  onClick={() =>
                    onSelectCategory(isSelected ? 'all' : item.category)
                  }
                  className={`w-full text-left rounded-md border px-3.5 py-2.5 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[#033367] bg-[#EBF2FA]'
                      : isHovered
                        ? 'border-[#033367]/60 bg-[#EBF2FA]'
                        : 'border-transparent bg-slate-50/60 hover:border-[#033367]/60 hover:bg-[#EBF2FA]'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`font-mono text-xs shrink-0 ${
                          isTop || isSelected || isHovered
                            ? 'font-semibold text-[#033367]'
                            : 'text-slate-400'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <span
                        className={`text-xs sm:text-sm truncate ${
                          isTop || isSelected || isHovered
                            ? 'font-semibold text-[#0A172E]'
                            : 'font-medium text-slate-700'
                        }`}
                      >
                        {item.category}
                      </span>
                      {isTop && (
                        <span className="hidden sm:inline-block rounded bg-[#033367]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#033367] shrink-0">
                          Terbanyak
                        </span>
                      )}
                    </div>

                    <span className="font-mono tabular-nums text-xs shrink-0">
                      <span className="font-semibold text-[#0A172E]">
                        {formatNumber(item.count)}
                      </span>{' '}
                      <span className="text-slate-500">({item.pct}%)</span>
                    </span>
                  </div>

                  <div className="mt-2 h-2.5 w-full rounded-xs bg-slate-200/70 overflow-hidden">
                    <div
                      className={`h-full rounded-xs transition-all duration-300 ${
                        isSelected || isHovered
                          ? 'bg-[#0A172E]'
                          : isTop
                            ? 'bg-[#033367]'
                            : 'bg-[#033367]/60'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Grafik 4: Peringkat Cabang Terbanyak (Khusus Admin) */}
      {showBranchChart && (
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#0A172E]">Grafik Cabang Terbanyak</h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {focusedBranchPoint ? (
                  <span className="text-[#033367] font-medium">
                    {focusedBranchPoint.branchName} ·{' '}
                    <span className="font-mono tabular-nums">
                      {formatNumber(focusedBranchPoint.count)} laporan ({focusedBranchPoint.pct}%)
                    </span>
                  </span>
                ) : (
                  'Peringkat cabang paling aktif melapor · Klik cabang untuk memfilter'
                )}
              </p>
            </div>

            {activeBranchId !== 'all' && (
              <button
                type="button"
                onClick={() => onSelectBranch('all')}
                className="text-xs font-medium text-[#033367] hover:underline whitespace-nowrap cursor-pointer shrink-0"
              >
                Semua Cabang
              </button>
            )}
          </div>

          {branchSeries.length === 0 ? (
            <div className="flex-1 min-h-[160px] flex items-center justify-center text-xs text-slate-400">
              Belum ada data laporan cabang pada rentang filter saat ini.
            </div>
          ) : (
            <div className="mt-4 space-y-2 flex-1">
              {branchSeries.map((item, idx) => {
                const isTop = idx === 0;
                const isSelected = activeBranchId === item.branchId;
                const isHovered = hoveredBranchId === item.branchId;
                const barPct = Math.max(4, Math.round((item.count / maxBranchCount) * 100));

                return (
                  <button
                    key={item.branchId}
                    type="button"
                    aria-pressed={isSelected}
                    onMouseEnter={() => setHoveredBranchId(item.branchId)}
                    onMouseLeave={() => setHoveredBranchId(null)}
                    onClick={() =>
                      onSelectBranch(isSelected ? 'all' : item.branchId)
                    }
                    className={`w-full text-left rounded-md border px-3.5 py-2.5 transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'border-[#033367] bg-[#EBF2FA]'
                        : isHovered
                          ? 'border-[#033367]/60 bg-[#EBF2FA]'
                          : 'border-transparent bg-slate-50/60 hover:border-[#033367]/60 hover:bg-[#EBF2FA]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-mono text-xs shrink-0 ${
                            isTop || isSelected || isHovered
                              ? 'font-semibold text-[#033367]'
                              : 'text-slate-400'
                          }`}
                        >
                          #{idx + 1}
                        </span>
                        <span
                          className={`text-xs sm:text-sm truncate ${
                            isTop || isSelected || isHovered
                              ? 'font-semibold text-[#0A172E]'
                              : 'font-medium text-slate-700'
                          }`}
                        >
                          {item.branchName}
                        </span>
                        <span className="hidden sm:inline-block font-mono text-[11px] text-slate-400 shrink-0">
                          {item.branchCode}
                        </span>
                        {isTop && (
                          <span className="hidden sm:inline-block rounded bg-[#033367]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#033367] shrink-0">
                            Terbanyak
                          </span>
                        )}
                      </div>

                      <span className="font-mono tabular-nums text-xs shrink-0">
                        <span className="font-semibold text-[#0A172E]">
                          {formatNumber(item.count)}
                        </span>{' '}
                        <span className="text-slate-500">({item.pct}%)</span>
                      </span>
                    </div>

                    <div className="mt-2 h-2.5 w-full rounded-xs bg-slate-200/70 overflow-hidden">
                      <div
                        className={`h-full rounded-xs transition-all duration-300 ${
                          isSelected || isHovered
                            ? 'bg-[#0A172E]'
                            : isTop
                              ? 'bg-[#033367]'
                              : 'bg-[#033367]/60'
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
