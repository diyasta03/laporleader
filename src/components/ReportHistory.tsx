import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  type Branch,
  type BranchReport,
  type ReportCategory,
  type ReportStatus,
  type UserProfile,
} from '../types';
import {
  downloadReportsCsv,
  formatDateId,
  formatDateTimeId,
  formatFileSize,
  formatNumber,
  formatTimeRange,
  getStatusTextClass,
} from '../lib/format';
import { DashboardCharts } from './DashboardCharts';

type SummaryCardKey = 'all' | 'under_review' | 'reviewed' | 'top_category';
type SortOption = 'newest' | 'oldest' | 'status' | 'branch';

interface ReportHistoryProps {
  user: UserProfile;
  branches: Branch[];
  reports: BranchReport[];
  loading: boolean;
  onRefreshData: () => Promise<void> | void;
  onCreateNew: () => void;
  onEditReport: (report: BranchReport) => void;
  onUpdateStatus: (id: string, status: ReportStatus, reviewNote: string) => Promise<void>;
  onDeleteReport: (id: string) => Promise<void>;
  onDownloadAttachment: (reportId: string, fileName?: string) => Promise<void>;
}

function getStatusBadgeClass(status: ReportStatus): string {
  return status === 'Reviewed'
    ? 'inline-flex items-center rounded border border-[#033367]/20 bg-[#033367]/8 px-2 py-0.5 text-[11px] font-semibold text-[#033367]'
    : 'inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800';
}

export function ReportHistory({
  user,
  branches,
  reports,
  loading,
  onRefreshData,
  onCreateNew,
  onEditReport,
  onUpdateStatus,
  onDeleteReport,
  onDownloadAttachment,
}: ReportHistoryProps) {
  const isAdmin = user.role === 'admin';
  const listSectionRef = useRef<HTMLElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ReportCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null);
  const [hoveredCardKey, setHoveredCardKey] = useState<SummaryCardKey | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [selectedReport, setSelectedReport] = useState<BranchReport | null>(null);
  const [drawerStatus, setDrawerStatus] = useState<ReportStatus>('Under Review');
  const [drawerReviewNote, setDrawerReviewNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusSavedMsg, setStatusSavedMsg] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [confirmDeleteReport, setConfirmDeleteReport] = useState<BranchReport | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Laporan untuk grafik peringkat cabang (tetap menampilkan semua cabang saat 1 cabang dipilih)
  const branchChartReports = useMemo(() => {
    if (!isAdmin) return [];
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((r) => {
      if (dateFrom && r.reportDate < dateFrom) return false;
      if (dateTo && r.reportDate > dateTo) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay =
          `${r.id} ${r.activityName} ${r.sharingSessionTitle} ${r.branchName} ${r.branchCode} ${r.category} ${r.createdByName} ${r.description} ${r.achievements} ${r.attachmentName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, isAdmin, dateFrom, dateTo, categoryFilter, statusFilter, searchQuery]);

  // Filter dasar (cabang, rentang tanggal, pencarian) sebagai konteks summary cards
  const baseScopedReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((r) => {
      if (isAdmin && branchFilter !== 'all' && r.branchId !== branchFilter) return false;
      if (dateFrom && r.reportDate < dateFrom) return false;
      if (dateTo && r.reportDate > dateTo) return false;
      if (q) {
        const hay =
          `${r.id} ${r.activityName} ${r.sharingSessionTitle} ${r.branchName} ${r.branchCode} ${r.category} ${r.createdByName} ${r.description} ${r.achievements} ${r.attachmentName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, isAdmin, branchFilter, dateFrom, dateTo, searchQuery]);

  // Summary cards mengikuti filter atas (cabang/tanggal/pencarian)
  const summaryStats = useMemo(() => {
    let underReview = 0;
    let reviewed = 0;
    const categoryCounts = new Map<ReportCategory, number>();

    for (const r of baseScopedReports) {
      if (r.status === 'Under Review') underReview += 1;
      if (r.status === 'Reviewed') reviewed += 1;
      categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    }

    let topCategory: { name: ReportCategory; count: number; pct: number } | null = null;
    for (const [name, count] of categoryCounts.entries()) {
      if (!topCategory || count > topCategory.count) {
        topCategory = {
          name,
          count,
          pct: baseScopedReports.length > 0 ? Math.round((count / baseScopedReports.length) * 100) : 0,
        };
      }
    }

    return {
      total: baseScopedReports.length,
      underReview,
      reviewed,
      topCategory,
    };
  }, [baseScopedReports]);

  // Daftar laporan akhir setelah seluruh filter & urutan diterapkan
  const filteredReports = useMemo(() => {
    const matched = baseScopedReports.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });

    const sorted = [...matched];
    sorted.sort((a, b) => {
      const keyA = `${a.reportDate}${a.startTime}${a.createdAt}`;
      const keyB = `${b.reportDate}${b.startTime}${b.createdAt}`;
      if (sortBy === 'oldest') return keyA.localeCompare(keyB);
      if (sortBy === 'status') {
        const stDiff = a.status.localeCompare(b.status);
        return stDiff !== 0 ? stDiff : keyB.localeCompare(keyA);
      }
      if (sortBy === 'branch') {
        const brDiff = a.branchName.localeCompare(b.branchName);
        return brDiff !== 0 ? brDiff : keyB.localeCompare(keyA);
      }
      return keyB.localeCompare(keyA);
    });
    return sorted;
  }, [baseScopedReports, categoryFilter, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, branchFilter, categoryFilter, statusFilter, dateFrom, dateTo, sortBy, pageSize]);

  const paginatedReports = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [filteredReports, safePage, pageSize]);

  const pageStartIndex = filteredReports.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEndIndex = Math.min(filteredReports.length, safePage * pageSize);

  const activeSummaryKey: SummaryCardKey | null = useMemo(() => {
    if (statusFilter === 'all' && categoryFilter === 'all') {
      return 'all';
    }
    if (statusFilter === 'Under Review' && categoryFilter === 'all') {
      return 'under_review';
    }
    if (statusFilter === 'Reviewed' && categoryFilter === 'all') {
      return 'reviewed';
    }
    if (
      summaryStats.topCategory &&
      categoryFilter === summaryStats.topCategory.name &&
      statusFilter === 'all'
    ) {
      return 'top_category';
    }
    return null;
  }, [statusFilter, categoryFilter, summaryStats.topCategory]);

  function handleSummaryCardClick(key: SummaryCardKey) {
    if (key === 'all') {
      setStatusFilter('all');
      setCategoryFilter('all');
    } else if (key === 'under_review') {
      const next = statusFilter === 'Under Review' ? 'all' : 'Under Review';
      setStatusFilter(next);
      setCategoryFilter('all');
    } else if (key === 'reviewed') {
      const next = statusFilter === 'Reviewed' ? 'all' : 'Reviewed';
      setStatusFilter(next);
      setCategoryFilter('all');
    } else if (key === 'top_category') {
      if (!summaryStats.topCategory) return;
      const topName = summaryStats.topCategory.name;
      setCategoryFilter(categoryFilter === topName ? 'all' : topName);
      setStatusFilter('all');
    }

    listSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleSelectChartDate(date: string) {
    if (dateFrom === date && dateTo === date) {
      setDateFrom('');
      setDateTo('');
    } else {
      setDateFrom(date);
      setDateTo(date);
    }
  }

  function openDetail(report: BranchReport) {
    setSelectedReport(report);
    setDrawerStatus(report.status);
    setDrawerReviewNote(report.reviewNote);
    setStatusSavedMsg(null);
    setPdfError(null);
  }

  async function handleSaveReviewStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedReport) return;
    setSavingStatus(true);
    setStatusSavedMsg(null);
    try {
      await onUpdateStatus(selectedReport.id, drawerStatus, drawerReviewNote.trim());
      setSelectedReport((prev) =>
        prev
          ? {
              ...prev,
              status: drawerStatus,
              reviewNote: drawerReviewNote.trim(),
              updatedAt: new Date().toISOString(),
            }
          : null
      );
      setStatusSavedMsg(`Status diperbarui menjadi ${drawerStatus}.`);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleQuickToggleStatus(report: BranchReport) {
    const nextStatus: ReportStatus =
      report.status === 'Reviewed' ? 'Under Review' : 'Reviewed';
    setTogglingStatusId(report.id);
    try {
      await onUpdateStatus(report.id, nextStatus, report.reviewNote);
    } finally {
      setTogglingStatusId(null);
    }
  }

  async function handleDownloadPdf(report: BranchReport) {
    setDownloadingPdfId(report.id);
    setPdfError(null);
    try {
      await onDownloadAttachment(report.id, report.attachmentName || `materi-${report.id}.pdf`);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Gagal mengunduh file PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  }

  const activeAdvancedFilterCount =
    (isAdmin && branchFilter !== 'all' ? 1 : 0) +
    (categoryFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const hasActiveFilters =
    Boolean(searchQuery) ||
    branchFilter !== 'all' ||
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  function resetFilters() {
    setSearchQuery('');
    setBranchFilter('all');
    setCategoryFilter('all');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteReport) return;
    setDeleting(true);
    try {
      await onDeleteReport(confirmDeleteReport.id);
      if (selectedReport?.id === confirmDeleteReport.id) {
        setSelectedReport(null);
      }
      setConfirmDeleteReport(null);
    } finally {
      setDeleting(false);
    }
  }

  const summaryCards: Array<{
    key: SummaryCardKey;
    label: string;
    value?: number;
    textValue?: string;
    hint: string;
    disabled?: boolean;
  }> = [
    {
      key: 'all',
      label: 'Total Laporan',
      value: summaryStats.total,
      hint: isAdmin
        ? branchFilter === 'all'
          ? 'Semua cabang'
          : branches.find((b) => b.id === branchFilter)?.code ?? 'Cabang dipilih'
        : user.branchCode ?? 'Cabang Anda',
    },
    {
      key: 'under_review',
      label: 'Under Review',
      value: summaryStats.underReview,
      hint: 'Menunggu tinjauan',
    },
    {
      key: 'reviewed',
      label: 'Reviewed',
      value: summaryStats.reviewed,
      hint: 'Sudah ditinjau',
    },
    {
      key: 'top_category',
      label: 'Kategori Terbanyak',
      textValue: summaryStats.topCategory ? summaryStats.topCategory.name : '—',
      hint: summaryStats.topCategory
        ? `${formatNumber(summaryStats.topCategory.count)} laporan · ${summaryStats.topCategory.pct}%`
        : 'Belum ada kegiatan',
      disabled: !summaryStats.topCategory,
    },
  ];

  const activeSingleDate = dateFrom && dateTo && dateFrom === dateTo ? dateFrom : null;

  return (
    <div className="space-y-6">
      {/* 1. FILTER PALING ATAS */}
      <section
        aria-label="Filter dashboard laporan"
        className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kegiatan, judul sharing session, cabang, atau pelapor..."
              className="w-full min-h-[42px] sm:min-h-[38px] rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((prev) => !prev)}
              aria-expanded={mobileFiltersOpen}
              className={`md:hidden min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                mobileFiltersOpen || activeAdvancedFilterCount > 0
                  ? 'border-[#033367] bg-[#033367]/5 text-[#033367]'
                  : 'border-slate-300 bg-white text-[#0A172E]'
              }`}
            >
              {activeAdvancedFilterCount > 0
                ? `Filter (${activeAdvancedFilterCount})`
                : mobileFiltersOpen
                  ? 'Tutup Filter'
                  : 'Filter'}
            </button>

            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {formatNumber(filteredReports.length)} laporan
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs font-medium text-[#033367] hover:underline whitespace-nowrap"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              disabled={filteredReports.length === 0}
              onClick={() =>
                downloadReportsCsv(
                  filteredReports,
                  `wm-center-laporan-${new Date().toISOString().slice(0, 10)}.csv`
                )
              }
              className="min-h-[38px] px-3 sm:px-3.5 py-1.5 text-xs font-medium text-[#0A172E] bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              Ekspor CSV
            </button>
          </div>
        </div>

        <div
          className={`${
            mobileFiltersOpen ? 'grid' : 'hidden md:grid'
          } grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center gap-2.5`}
        >
          {isAdmin && (
            <select
              aria-label="Filter cabang"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full lg:w-auto min-h-[40px] sm:min-h-[36px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0A172E] focus:border-[#033367] focus:outline-none"
            >
              <option value="all">Semua Cabang ({branches.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Filter kategori"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ReportCategory)}
            className="w-full lg:w-auto min-h-[40px] sm:min-h-[36px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0A172E] focus:border-[#033367] focus:outline-none"
          >
            <option value="all">Semua Kategori</option>
            {REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ReportStatus)}
            className="w-full lg:w-auto min-h-[40px] sm:min-h-[36px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0A172E] focus:border-[#033367] focus:outline-none"
          >
            <option value="all">Semua Status</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="sm:col-span-2 lg:col-span-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 text-xs text-slate-500">
            <input
              type="date"
              aria-label="Dari tanggal"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full min-h-[40px] sm:min-h-[36px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#0A172E] focus:border-[#033367] focus:outline-none"
            />
            <span>–</span>
            <input
              type="date"
              aria-label="Sampai tanggal"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full min-h-[40px] sm:min-h-[36px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#0A172E] focus:border-[#033367] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* 2. CLICKABLE SUMMARY CARDS */}
      <section aria-label="Ringkasan interaktif laporan">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryCards.map((card) => {
            const isActive = activeSummaryKey === card.key;
            const isHovered = hoveredCardKey === card.key && !card.disabled;
            return (
              <button
                key={card.key}
                type="button"
                disabled={card.disabled}
                aria-pressed={isActive}
                onMouseEnter={() => !card.disabled && setHoveredCardKey(card.key)}
                onMouseLeave={() => setHoveredCardKey(null)}
                onClick={() => handleSummaryCardClick(card.key)}
                className={`flex flex-col justify-between text-left rounded-lg border px-4 py-3.5 sm:py-4 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#033367] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-default ${
                  card.disabled ? '' : 'cursor-pointer'
                } ${
                  isActive
                    ? isHovered
                      ? 'bg-[#0A172E] border-[#0A172E] text-white -translate-y-0.5 shadow-md'
                      : 'bg-[#033367] border-[#033367] text-white shadow-xs'
                    : isHovered
                      ? 'bg-[#EBF2FA] border-[#033367] text-[#0A172E] -translate-y-0.5 shadow-md'
                      : 'bg-white border-slate-200 text-[#0A172E] hover:border-[#033367] hover:bg-[#EBF2FA] hover:-translate-y-0.5 hover:shadow-md'
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    isActive ? 'text-white/80' : 'text-slate-500'
                  }`}
                >
                  {card.label}
                </div>

                {card.textValue !== undefined ? (
                  <div
                    className={`mt-1.5 text-sm sm:text-[15px] font-semibold leading-snug line-clamp-2 ${
                      isActive ? 'text-white' : 'text-[#0A172E]'
                    }`}
                  >
                    {card.textValue}
                  </div>
                ) : (
                  <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums">
                    {formatNumber(card.value ?? 0)}
                  </div>
                )}

                <div
                  className={`mt-1.5 text-xs truncate ${
                    card.textValue !== undefined
                      ? isActive
                        ? 'text-white/80 font-mono tabular-nums'
                        : 'text-[#033367] font-mono tabular-nums font-medium'
                      : isActive
                        ? 'text-white/70'
                        : 'text-slate-400'
                  }`}
                >
                  {card.hint}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. GRAFIK & DIAGRAM INTERAKTIF */}
      <DashboardCharts
        reports={filteredReports}
        categoryReports={
          statusFilter === 'all'
            ? baseScopedReports
            : baseScopedReports.filter((r) => r.status === statusFilter)
        }
        branchReports={branchChartReports}
        showBranchChart={isAdmin}
        activeDate={activeSingleDate}
        activeStatus={statusFilter}
        activeCategory={categoryFilter}
        activeBranchId={branchFilter}
        onSelectDate={handleSelectChartDate}
        onSelectStatus={setStatusFilter}
        onSelectCategory={setCategoryFilter}
        onSelectBranch={setBranchFilter}
      />

      {/* 4. DAFTAR RIWAYAT LAPORAN */}
      <section
        ref={listSectionRef}
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3.5 sm:px-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#0A172E]">Riwayat Laporan Kegiatan</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {filteredReports.length > 0
                ? `Menampilkan ${formatNumber(pageStartIndex)}–${formatNumber(pageEndIndex)} dari ${formatNumber(filteredReports.length)} laporan · Klik baris untuk lihat detail lengkap`
                : `Menampilkan 0 dari ${formatNumber(reports.length)} laporan`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Urutkan laporan"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-[#0A172E] focus:border-[#033367] focus:outline-none"
            >
              <option value="newest">Urutkan: Terbaru</option>
              <option value="oldest">Urutkan: Terlama</option>
              <option value="status">Urutkan: Status</option>
              {isAdmin && <option value="branch">Urutkan: Cabang A–Z</option>}
            </select>

            <button
              type="button"
              disabled={loading}
              onClick={() => onRefreshData()}
              className="min-h-[34px] px-3 py-1 text-xs font-medium text-[#0A172E] bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loading ? 'Menyegarkan...' : 'Segarkan'}
            </button>
          </div>
        </div>

        {loading && reports.length === 0 ? (
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse"
              >
                <div className="space-y-2 flex-1">
                  <div className="h-3.5 bg-slate-200 rounded w-1/2" />
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                </div>
                <div className="h-5 bg-slate-100 rounded w-24" />
              </div>
            ))}
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-[#0A172E]">
              {hasActiveFilters
                ? 'Tidak ada laporan kegiatan yang sesuai filter'
                : 'Belum ada laporan kegiatan'}
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Ubah filter di atas atau klik Reset Filter untuk melihat seluruh laporan.'
                : 'Mulai catat laporan kegiatan harian cabang pertama Anda.'}
            </p>
            <div className="mt-5">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-[#0A172E] bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Reset Filter
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#033367] rounded-md hover:bg-[#0A172E]"
                >
                  Buat Laporan Pertama
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile List (< md) */}
            <div className="md:hidden divide-y divide-slate-200">
              {paginatedReports.map((report) => {
                const isToggling = togglingStatusId === report.id;
                const isRowHovered = hoveredRowId === report.id;
                return (
                  <article
                    key={report.id}
                    onMouseEnter={() => setHoveredRowId(report.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                    onClick={() => openDetail(report)}
                    className={`p-4 space-y-2.5 cursor-pointer border-l-4 transition-all duration-150 ${
                      isRowHovered
                        ? 'border-l-[#033367] bg-[#EBF2FA]'
                        : 'border-l-transparent hover:border-l-[#033367] hover:bg-[#EBF2FA]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-500 font-mono min-w-0">
                        <span className="tabular-nums text-[#0A172E] font-medium">
                          {formatDateId(report.reportDate)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatTimeRange(report.startTime, report.endTime)}
                        </span>
                      </div>
                      <span className={`shrink-0 ${getStatusBadgeClass(report.status)}`}>
                        {report.status}
                      </span>
                    </div>

                    {isAdmin && (
                      <div className="text-xs font-medium text-[#033367]">
                        {report.branchName} · <span className="font-mono">{report.branchCode}</span>
                      </div>
                    )}

                    <div className="text-sm font-semibold text-[#0A172E] leading-snug">
                      {report.activityName}
                    </div>

                    {report.sharingSessionTitle ? (
                      <p className="text-xs text-[#033367] line-clamp-1">
                        Sharing Session: <span className="font-medium">{report.sharingSessionTitle}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600 line-clamp-1">{report.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{report.createdByName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{report.category}</span>
                    </div>

                    <div
                      className="pt-1.5 flex flex-wrap items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div>
                        {report.hasAttachment && (
                          <button
                            type="button"
                            disabled={downloadingPdfId === report.id}
                            onClick={() => handleDownloadPdf(report)}
                            className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-[#033367] bg-[#033367]/5 border border-[#033367]/20 rounded-md hover:bg-[#033367]/10 disabled:opacity-60"
                          >
                            {downloadingPdfId === report.id ? 'Mengunduh...' : 'Unduh PDF'}
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleQuickToggleStatus(report)}
                              className="min-h-[34px] px-3 py-1 text-xs font-medium text-[#033367] bg-white border border-[#033367]/30 rounded-md hover:bg-[#033367]/5 disabled:opacity-50"
                            >
                              {isToggling
                                ? 'Menyimpan...'
                                : report.status === 'Reviewed'
                                  ? 'Set Under Review'
                                  : 'Tandai Reviewed'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditReport(report)}
                              className="min-h-[34px] px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                            >
                              Ubah
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => openDetail(report)}
                          className="min-h-[34px] px-3 py-1 text-xs font-medium text-[#0A172E] bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100"
                        >
                          Detail
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Desktop Scannable Table (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-semibold text-slate-600">
                    <th className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSortBy((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
                        className="inline-flex items-center gap-1 hover:text-[#033367] transition-colors"
                      >
                        <span>Waktu</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {sortBy === 'newest' ? '↓' : sortBy === 'oldest' ? '↑' : ''}
                        </span>
                      </button>
                    </th>
                    {isAdmin && (
                      <th className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSortBy('branch')}
                          className="inline-flex items-center gap-1 hover:text-[#033367] transition-colors"
                        >
                          <span>Cabang</span>
                          {sortBy === 'branch' && (
                            <span className="font-mono text-[10px] text-slate-400">↑</span>
                          )}
                        </button>
                      </th>
                    )}
                    <th className="py-3 px-3">Kegiatan & Ringkasan</th>
                    <th className="py-3 px-3 whitespace-nowrap">Pelapor & Kategori</th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSortBy('status')}
                        className="inline-flex items-center gap-1 hover:text-[#033367] transition-colors"
                      >
                        <span>Status</span>
                        {sortBy === 'status' && (
                          <span className="font-mono text-[10px] text-slate-400">↑</span>
                        )}
                      </button>
                    </th>
                    <th className="py-3 pl-3 pr-5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedReports.map((report) => {
                    const isToggling = togglingStatusId === report.id;
                    const isRowHovered = hoveredRowId === report.id;
                    return (
                      <tr
                        key={report.id}
                        onMouseEnter={() => setHoveredRowId(report.id)}
                        onMouseLeave={() => setHoveredRowId(null)}
                        onClick={() => openDetail(report)}
                        className={`group cursor-pointer transition-colors duration-150 ${
                          isRowHovered ? 'bg-[#EBF2FA]' : 'hover:bg-[#EBF2FA]'
                        }`}
                      >
                        <td
                          className={`py-4 pl-4 pr-3 whitespace-nowrap align-top border-l-4 transition-colors duration-150 ${
                            isRowHovered
                              ? 'border-l-[#033367]'
                              : 'border-l-transparent group-hover:border-l-[#033367]'
                          }`}
                        >
                          <div
                            className={`font-mono tabular-nums text-xs font-semibold transition-colors ${
                              isRowHovered
                                ? 'text-[#033367]'
                                : 'text-[#0A172E] group-hover:text-[#033367]'
                            }`}
                          >
                            {formatDateId(report.reportDate)}
                          </div>
                          <div className="font-mono tabular-nums text-xs text-slate-500 mt-1">
                            {formatTimeRange(report.startTime, report.endTime)}
                          </div>
                        </td>

                        {isAdmin && (
                          <td className="py-4 px-3 whitespace-nowrap align-top">
                            <div className="text-sm font-medium text-[#0A172E]">
                              {report.branchName}
                            </div>
                            <div className="text-xs font-mono text-[#033367]/80 mt-0.5">
                              {report.branchCode}
                            </div>
                          </td>
                        )}

                        <td className="py-4 px-3 align-top max-w-md">
                          <div
                            className={`font-semibold transition-colors line-clamp-1 ${
                              isRowHovered
                                ? 'text-[#033367]'
                                : 'text-[#0A172E] group-hover:text-[#033367]'
                            }`}
                          >
                            {report.activityName}
                          </div>
                          {report.sharingSessionTitle ? (
                            <div className="mt-1 text-xs text-[#033367] line-clamp-1">
                              Sharing Session: {report.sharingSessionTitle}
                            </div>
                          ) : (
                            <div className="mt-1 text-xs text-slate-500 line-clamp-1">
                              {report.description}
                            </div>
                          )}

                          {report.hasAttachment && (
                            <div
                              className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={downloadingPdfId === report.id}
                                onClick={() => handleDownloadPdf(report)}
                                className="rounded border border-[#033367]/20 bg-[#033367]/5 px-2 py-0.5 font-mono text-[11px] font-medium text-[#033367] hover:bg-[#033367]/10 disabled:opacity-60"
                              >
                                {downloadingPdfId === report.id ? 'Mengunduh...' : 'Unduh PDF'}
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-3 align-top max-w-[200px]">
                          <div className="text-xs font-medium text-[#0A172E] truncate">
                            {report.createdByName}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 line-clamp-1">
                            {report.category}
                          </div>
                        </td>

                        <td
                          className="py-4 px-3 whitespace-nowrap align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div>
                            <span className={getStatusBadgeClass(report.status)}>
                              {report.status}
                            </span>
                          </div>
                          {isAdmin && (
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleQuickToggleStatus(report)}
                              className="mt-1.5 block text-[11px] font-medium text-slate-500 hover:text-[#033367] hover:underline disabled:opacity-50"
                            >
                              {isToggling
                                ? 'Menyimpan...'
                                : report.status === 'Reviewed'
                                  ? 'Kembalikan Under Review'
                                  : 'Tandai Reviewed'}
                            </button>
                          )}
                        </td>

                        <td
                          className="py-4 pl-3 pr-5 text-right whitespace-nowrap align-top text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDetail(report)}
                              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors duration-150 ${
                                isRowHovered
                                  ? 'bg-[#033367] text-white hover:bg-[#0A172E]'
                                  : 'text-[#033367] bg-[#033367]/8 group-hover:bg-[#033367] group-hover:text-white'
                              }`}
                            >
                              Detail
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onEditReport(report)}
                                  className="px-2.5 py-1.5 rounded-md font-medium text-slate-700 hover:bg-slate-200/70 hover:text-[#0A172E] transition-colors duration-150"
                                >
                                  Ubah
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteReport(report)}
                                  className="px-2.5 py-1.5 rounded-md font-medium text-rose-700 hover:bg-rose-100/80 transition-colors duration-150"
                                >
                                  Hapus
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {filteredReports.length > 0 && (
              <div className="px-4 py-3 sm:px-5 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <span>Tampilkan</span>
                  <select
                    aria-label="Jumlah baris per halaman"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-[#0A172E] focus:border-[#033367] focus:outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                  <span>baris per halaman</span>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <span className="font-mono tabular-nums text-slate-500">
                      Halaman {safePage} / {totalPages}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="min-h-[32px] px-3 py-1 rounded border border-slate-300 bg-white font-medium text-[#0A172E] hover:bg-slate-50 disabled:opacity-40"
                      >
                        Sebelumnya
                      </button>
                      <button
                        type="button"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="min-h-[32px] px-3 py-1 rounded border border-slate-300 bg-white font-medium text-[#0A172E] hover:bg-slate-50 disabled:opacity-40"
                      >
                        Berikutnya
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Slide-over Detail Laporan & Panel Review Admin */}
      {selectedReport && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-[#0A172E]/35"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-drawer-title"
          onClick={() => setSelectedReport(null)}
        >
          <div
            className="w-full sm:max-w-xl bg-white h-dvh border-l border-slate-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                  <span>{selectedReport.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateId(selectedReport.reportDate)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatTimeRange(selectedReport.startTime, selectedReport.endTime)}</span>
                </div>
                <h3
                  id="detail-drawer-title"
                  className="mt-1 text-base font-semibold text-[#0A172E] leading-snug"
                >
                  {selectedReport.activityName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="p-2 -mr-1.5 text-slate-400 hover:text-[#0A172E] rounded-md shrink-0"
                aria-label="Tutup detail"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                <span className="font-semibold text-[#0A172E]">
                  {selectedReport.branchName} ({selectedReport.branchCode})
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedReport.category}</span>
                <span aria-hidden="true">·</span>
                <span className={getStatusTextClass(selectedReport.status)}>
                  {selectedReport.status}
                </span>
              </div>

              {selectedReport.sharingSessionTitle && (
                <div className="rounded-md border border-[#033367]/20 bg-[#F7F9FC] px-4 py-3.5 space-y-3">
                  <div>
                    <div className="text-xs font-medium text-[#033367]">Judul Sharing Session</div>
                    <div className="mt-1 text-sm font-semibold text-[#0A172E]">
                      {selectedReport.sharingSessionTitle}
                    </div>
                  </div>

                  {selectedReport.hasAttachment && (
                    <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#0A172E] truncate">
                          {selectedReport.attachmentName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          PDF · {formatFileSize(selectedReport.attachmentSize)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={downloadingPdfId === selectedReport.id}
                        onClick={() => handleDownloadPdf(selectedReport)}
                        className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold text-white bg-[#033367] rounded-md hover:bg-[#0A172E] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                      >
                        {downloadingPdfId === selectedReport.id ? 'Mengunduh...' : 'Unduh PDF'}
                      </button>
                    </div>
                  )}

                  {pdfError && (
                    <p role="alert" className="text-xs text-rose-700">
                      {pdfError}
                    </p>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-500">Uraian Kegiatan</h4>
                <p className="mt-1.5 text-sm text-[#0A172E] leading-relaxed whitespace-pre-line">
                  {selectedReport.description}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-500">Capaian</h4>
                <p className="mt-1.5 text-sm text-[#0A172E] leading-relaxed whitespace-pre-line">
                  {selectedReport.achievements}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                <div>
                  <h4 className="text-xs font-semibold text-slate-500">Kendala</h4>
                  <p className="mt-1.5 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {selectedReport.issues}
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-500">Tindak Lanjut</h4>
                  <p className="mt-1.5 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {selectedReport.followUp}
                  </p>
                </div>
              </div>

              {isAdmin ? (
                <form
                  onSubmit={handleSaveReviewStatus}
                  className="pt-5 border-t border-slate-200 space-y-3"
                >
                  <div className="text-xs font-semibold text-[#0A172E]">
                    Tinjauan Status Admin
                  </div>

                  {statusSavedMsg && (
                    <div
                      role="status"
                      className="rounded-md border border-[#033367]/20 bg-[#033367]/5 px-3 py-2 text-xs text-[#033367]"
                    >
                      {statusSavedMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {REPORT_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setDrawerStatus(st)}
                        className={`min-h-[40px] rounded-md border text-xs font-semibold transition-colors ${
                          drawerStatus === st
                            ? 'bg-[#033367] border-[#033367] text-white'
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label
                      htmlFor="drawer-review-note"
                      className="block text-xs font-medium text-slate-600"
                    >
                      Catatan Review (Opsional)
                    </label>
                    <textarea
                      id="drawer-review-note"
                      rows={2}
                      value={drawerReviewNote}
                      onChange={(e) => setDrawerReviewNote(e.target.value)}
                      placeholder="Berikan catatan atau arahan kepada Leader cabang..."
                      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingStatus}
                    className="w-full min-h-[40px] rounded-md bg-[#033367] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A172E] disabled:opacity-60 transition-colors"
                  >
                    {savingStatus ? 'Menyimpan...' : 'Simpan Status Review'}
                  </button>
                </form>
              ) : (
                selectedReport.reviewNote && (
                  <div className="pt-4 border-t border-slate-100">
                    <h4 className="text-xs font-semibold text-[#033367]">Catatan Review Admin</h4>
                    <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">
                      {selectedReport.reviewNote}
                    </p>
                  </div>
                )
              )}

              <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                <p>
                  Pelapor:{' '}
                  <span className="text-[#0A172E] font-medium">{selectedReport.createdByName}</span>{' '}
                  ({selectedReport.createdByRole === 'admin' ? 'Admin' : 'Leader'})
                </p>
                <p>Dibuat: {formatDateTimeId(selectedReport.createdAt)}</p>
                <p>Diperbarui: {formatDateTimeId(selectedReport.updatedAt)}</p>
              </div>
            </div>

            {isAdmin && (
              <div className="px-5 sm:px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteReport(selectedReport)}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-md transition-colors"
                >
                  Hapus Laporan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedReport;
                    setSelectedReport(null);
                    onEditReport(target);
                  }}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-[#0A172E] bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors"
                >
                  Ubah Isi Laporan
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {confirmDeleteReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A172E]/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <h3 className="text-base font-semibold text-[#0A172E]">Hapus Laporan Ini?</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Laporan <span className="font-mono font-medium">{confirmDeleteReport.id}</span> dari{' '}
              <span className="font-medium text-[#0A172E]">{confirmDeleteReport.branchName}</span>{' '}
              akan dihapus secara permanen.
            </p>

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDeleteReport(null)}
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-rose-700 rounded-md hover:bg-rose-800 disabled:opacity-60"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
