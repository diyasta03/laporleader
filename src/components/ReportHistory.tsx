import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
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
  formatNumber,
  getStatusTextClass,
} from '../lib/format';

interface ReportHistoryProps {
  user: UserProfile;
  branches: Branch[];
  reports: BranchReport[];
  loading: boolean;
  onCreateNew: () => void;
  onEditReport: (report: BranchReport) => void;
  onDeleteReport: (id: string) => Promise<void>;
}

export function ReportHistory({
  user,
  branches,
  reports,
  loading,
  onCreateNew,
  onEditReport,
  onDeleteReport,
}: ReportHistoryProps) {
  const isAdmin = user.role === 'admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ReportCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedReport, setSelectedReport] = useState<BranchReport | null>(null);
  const [confirmDeleteReport, setConfirmDeleteReport] = useState<BranchReport | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((r) => {
      if (isAdmin && branchFilter !== 'all' && r.branchId !== branchFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (dateFrom && r.reportDate < dateFrom) return false;
      if (dateTo && r.reportDate > dateTo) return false;
      if (q) {
        const hay = `${r.id} ${r.title} ${r.branchName} ${r.branchCode} ${r.category} ${r.shift} ${r.createdByName} ${r.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, isAdmin, branchFilter, categoryFilter, statusFilter, dateFrom, dateTo, searchQuery]);

  const metrics = useMemo(() => {
    const uniqueBranches = new Set<string>();
    let completed = 0;
    let withIssues = 0;
    let totalStaff = 0;

    for (const r of filteredReports) {
      uniqueBranches.add(r.branchId);
      if (r.status === 'Selesai') completed += 1;
      if (r.issues.trim().length > 0 || r.status === 'Perlu Revisi') withIssues += 1;
      totalStaff += r.staffPresent;
    }

    return {
      count: filteredReports.length,
      completed,
      withIssues,
      activeBranches: uniqueBranches.size,
      avgStaff: filteredReports.length > 0 ? Math.round(totalStaff / filteredReports.length) : 0,
    };
  }, [filteredReports]);

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

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* KPI Summary Strip — Hairline 1px grid sempurna di mobile 2x2 & desktop 4x1 */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-px">
        <div className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <p className="text-xs text-slate-500">Total Laporan</p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatNumber(metrics.count)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 truncate">
            {isAdmin ? 'Lintas cabang' : user.branchName ?? 'Cabang aktif'}
          </p>
        </div>

        <div className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <p className="text-xs text-slate-500">Kegiatan Selesai</p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatNumber(metrics.completed)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 truncate">Berstatus selesai</p>
        </div>

        <div className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <p className="text-xs text-slate-500">Catatan Kendala</p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatNumber(metrics.withIssues)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 truncate">Perlu tindak lanjut</p>
        </div>

        <div className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <p className="text-xs text-slate-500 truncate">
            {isAdmin ? 'Cabang Melapor' : 'Rata-rata Staf'}
          </p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {isAdmin
              ? `${formatNumber(metrics.activeBranches)} / ${formatNumber(branches.length)}`
              : `${formatNumber(metrics.avgStaff)} org`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 truncate">
            {isAdmin ? 'Cabang aktif' : 'Kehadiran per laporan'}
          </p>
        </div>
      </section>

      {/* Filter Toolbar & Responsive Data View */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 sm:px-5 sm:py-4 border-b border-slate-200 space-y-3">
          {/* Baris Pencarian & Aksi */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari kegiatan, ID, cabang, atau pelapor..."
                className="w-full min-h-[42px] sm:min-h-[38px] rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2.5">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
                >
                  Reset Filter
                </button>
              )}
              <button
                type="button"
                disabled={filteredReports.length === 0}
                onClick={() =>
                  downloadReportsCsv(
                    filteredReports,
                    `laporan-kegiatan-cabang-${new Date().toISOString().slice(0, 10)}.csv`
                  )
                }
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[36px] px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Ekspor CSV</span>
              </button>
            </div>
          </div>

          {/* Filter Grid Responsif */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center gap-2.5">
            {isAdmin && (
              <select
                aria-label="Filter cabang"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="w-full lg:w-auto min-h-[40px] sm:min-h-[34px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none"
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
              className="w-full lg:w-auto min-h-[40px] sm:min-h-[34px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none"
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
              className="w-full lg:w-auto min-h-[40px] sm:min-h-[34px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none"
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
                className="w-full min-h-[40px] sm:min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-700 focus:border-teal-700 focus:outline-none"
              />
              <span>–</span>
              <input
                type="date"
                aria-label="Sampai tanggal"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full min-h-[40px] sm:min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-700 focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="px-4 sm:px-5 py-4 flex items-center justify-between gap-4 animate-pulse">
                <div className="space-y-2 flex-1">
                  <div className="h-3.5 bg-slate-200 rounded w-2/3 sm:w-1/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
                <div className="h-3.5 bg-slate-200 rounded w-16" />
              </div>
            ))}
          </div>
        ) : filteredReports.length === 0 ? (
          /* Empty State */
          <div className="px-6 py-14 sm:py-16 text-center">
            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              {hasActiveFilters
                ? 'Tidak ada laporan kegiatan yang cocok'
                : 'Belum ada laporan kegiatan cabang'}
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Ubah kata kunci pencarian atau reset filter untuk melihat riwayat kegiatan lainnya.'
                : 'Mulai catat laporan kegiatan harian cabang pertama Anda sekarang.'}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  Reset Filter
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Buat Laporan Pertama</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile Stacked List (< md) — Tanpa horizontal scroll */}
            <div className="md:hidden divide-y divide-slate-200">
              {filteredReports.map((report) => (
                <article key={report.id} className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500 font-mono min-w-0">
                      <span className="tabular-nums text-slate-700 font-medium">
                        {formatDateId(report.reportDate)}
                      </span>
                      {isAdmin && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate font-sans font-medium text-slate-800">
                            {report.branchName}
                          </span>
                        </>
                      )}
                    </div>
                    <span className={`shrink-0 ${getStatusTextClass(report.status)}`}>
                      {report.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedReport(report)}
                    className="block text-left text-sm font-semibold text-slate-900 hover:text-teal-700 leading-snug"
                  >
                    {report.title}
                  </button>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{report.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Shift {report.shift}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatNumber(report.staffPresent)} staf
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{report.createdByName}</span>
                  </div>

                  <div className="pt-1 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedReport(report)}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Detail</span>
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEditReport(report)}
                          className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Ubah</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteReport(report)}
                          aria-label="Hapus laporan"
                          className="min-h-[36px] inline-flex items-center justify-center px-2.5 py-1.5 text-rose-700 bg-white border border-slate-200 rounded-md hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {/* Desktop High-Density Table (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 pl-5 pr-3 whitespace-nowrap">Tanggal</th>
                    {isAdmin && <th className="py-3 px-3 whitespace-nowrap">Cabang</th>}
                    <th className="py-3 px-3">Kegiatan</th>
                    <th className="py-3 px-3 whitespace-nowrap">Shift</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Staf Hadir</th>
                    <th className="py-3 px-3 whitespace-nowrap">Status</th>
                    <th className="py-3 pl-3 pr-5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredReports.map((report) => (
                    <tr
                      key={report.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 pl-5 pr-3 whitespace-nowrap align-top">
                        <div className="font-mono tabular-nums text-xs font-medium text-slate-900">
                          {formatDateId(report.reportDate)}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                          {report.id}
                        </div>
                      </td>

                      {isAdmin && (
                        <td className="py-3 px-3 whitespace-nowrap align-top">
                          <div className="text-sm font-medium text-slate-900">
                            {report.branchName}
                          </div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {report.branchCode}
                          </div>
                        </td>
                      )}

                      <td className="py-3 px-3 align-top max-w-lg">
                        <button
                          type="button"
                          onClick={() => setSelectedReport(report)}
                          className="text-left font-medium text-slate-900 hover:text-teal-700 transition-colors line-clamp-1"
                        >
                          {report.title}
                        </button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <span>{report.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{report.createdByName}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap align-top text-xs text-slate-700">
                        {report.shift}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap align-top font-mono tabular-nums text-slate-700">
                        {formatNumber(report.staffPresent)} org
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap align-top text-xs">
                        <span className={getStatusTextClass(report.status)}>
                          {report.status}
                        </span>
                      </td>

                      <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap align-top">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedReport(report)}
                            title="Lihat detail"
                            className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-slate-100 rounded transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => onEditReport(report)}
                                title="Ubah laporan"
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteReport(report)}
                                title="Hapus laporan"
                                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Slide-over Detail Laporan */}
      {selectedReport && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/35"
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
                <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                  <span>{selectedReport.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateId(selectedReport.reportDate)}</span>
                </div>
                <h3
                  id="detail-drawer-title"
                  className="mt-1 text-base font-semibold text-slate-900 leading-snug"
                >
                  {selectedReport.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="p-2 -mr-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 shrink-0"
                aria-label="Tutup detail"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                <span className="font-medium text-slate-900">
                  {selectedReport.branchName} ({selectedReport.branchCode})
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedReport.category}</span>
                <span aria-hidden="true">·</span>
                <span className={getStatusTextClass(selectedReport.status)}>
                  {selectedReport.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-4 border-y border-slate-200 py-4">
                <div>
                  <dt className="text-xs text-slate-500">Shift Pelaksanaan</dt>
                  <dd className="mt-1 text-base font-semibold text-slate-900">
                    Shift {selectedReport.shift}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Staf Hadir</dt>
                  <dd className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
                    {formatNumber(selectedReport.staffPresent)} orang
                  </dd>
                </div>
              </dl>

              <div>
                <h4 className="text-xs font-semibold text-slate-500">Uraian Kegiatan & Capaian</h4>
                <p className="mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                  {selectedReport.summary}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-500">Kendala & Tindak Lanjut</h4>
                <p className="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {selectedReport.issues || 'Tidak ada kendala yang dilaporkan.'}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                <p>
                  Dilaporkan oleh:{' '}
                  <span className="text-slate-700 font-medium">{selectedReport.createdByName}</span>{' '}
                  ({selectedReport.createdByRole === 'admin' ? 'Admin' : 'Leader'})
                </p>
                <p>Dibuat: {formatDateTimeId(selectedReport.createdAt)}</p>
                <p>Terakhir diperbarui: {formatDateTimeId(selectedReport.updatedAt)}</p>
              </div>
            </div>

            {isAdmin && (
              <div className="px-5 sm:px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteReport(selectedReport)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Hapus</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedReport;
                    setSelectedReport(null);
                    onEditReport(target);
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  <span>Ubah Laporan</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus (Admin Only) */}
      {confirmDeleteReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">Hapus Laporan Ini?</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Laporan <span className="font-mono font-medium">{confirmDeleteReport.id}</span>{' '}
                  milik <span className="font-medium">{confirmDeleteReport.branchName}</span> akan
                  dihapus secara permanen.
                </p>
              </div>
            </div>

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
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-60"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus Laporan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
