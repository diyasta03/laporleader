import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock, Save } from 'lucide-react';
import {
  REPORT_CATEGORIES,
  REPORT_SHIFTS,
  REPORT_STATUSES,
  type Branch,
  type BranchReport,
  type ReportCategory,
  type ReportPayload,
  type ReportShift,
  type ReportStatus,
  type UserProfile,
} from '../types';
import { getTodayIsoDate } from '../lib/format';

interface ReportFormProps {
  user: UserProfile;
  branches: Branch[];
  editingReport?: BranchReport | null;
  onSubmit: (payload: ReportPayload, editId?: string) => Promise<void>;
  onCancel?: () => void;
}

export function ReportForm({
  user,
  branches,
  editingReport,
  onSubmit,
  onCancel,
}: ReportFormProps) {
  const isAdmin = user.role === 'admin';
  const defaultBranchId =
    editingReport?.branchId ??
    (isAdmin ? branches[0]?.id ?? '' : user.branchId ?? '');

  const [reportDate, setReportDate] = useState(
    editingReport?.reportDate ?? getTodayIsoDate()
  );
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [title, setTitle] = useState(editingReport?.title ?? '');
  const [category, setCategory] = useState<ReportCategory>(
    editingReport?.category ?? 'Operasional Harian'
  );
  const [shift, setShift] = useState<ReportShift>(editingReport?.shift ?? 'Penuh');
  const [staffPresent, setStaffPresent] = useState(
    editingReport ? String(editingReport.staffPresent) : ''
  );
  const [summary, setSummary] = useState(editingReport?.summary ?? '');
  const [issues, setIssues] = useState(editingReport?.issues ?? '');
  const [status, setStatus] = useState<ReportStatus>(
    editingReport?.status ?? 'Terkirim'
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(isAdmin ? branches[0].id : user.branchId ?? branches[0].id);
    }
  }, [branches, branchId, isAdmin, user.branchId]);

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);

    try {
      const payload: ReportPayload = {
        reportDate,
        branchId: isAdmin ? branchId : user.branchId ?? '',
        title: title.trim(),
        category,
        shift,
        staffPresent: Math.floor(Number(staffPresent || 0)),
        summary: summary.trim(),
        issues: issues.trim(),
        ...(isAdmin ? { status } : {}),
      };

      await onSubmit(payload, editingReport?.id);

      if (!editingReport) {
        setTitle('');
        setStaffPresent('');
        setSummary('');
        setIssues('');
        setSuccessMsg('Laporan kegiatan berhasil dikirim dan tercatat ke riwayat cabang.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan laporan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            {editingReport
              ? `Ubah Laporan ${editingReport.id}`
              : isAdmin
                ? 'Form Laporan Kegiatan Semua Cabang'
                : 'Form Laporan Kegiatan Cabang'}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            {isAdmin
              ? 'Pilih cabang tujuan dan catat uraian kegiatan operasional cabang.'
              : `Laporan kegiatan akan dicatat khusus untuk ${user.branchName ?? 'cabang Anda'} (${user.branchCode ?? '-'}).`}
          </p>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="hidden sm:inline-flex min-h-[38px] items-center px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Batal
          </button>
        )}
      </div>

      <form onSubmit={handleFormSubmit} className="p-4 sm:p-6 space-y-5 sm:space-y-6">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Baris 1: Cabang, Tanggal, Kategori */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <div>
            <label htmlFor="report-branch" className="block text-sm font-medium text-slate-700">
              Cabang
            </label>
            {isAdmin ? (
              <select
                id="report-branch"
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-1.5 min-h-[44px] flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <span className="truncate font-medium">
                  {user.branchCode} — {user.branchName}
                </span>
                <Lock className="w-4 h-4 text-slate-400 shrink-0 ml-2" aria-label="Terkunci ke cabang kerja" />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="report-date" className="block text-sm font-medium text-slate-700">
              Tanggal Kegiatan
            </label>
            <input
              id="report-date"
              type="date"
              required
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <div>
            <label htmlFor="report-category" className="block text-sm font-medium text-slate-700">
              Kategori Kegiatan
            </label>
            <select
              id="report-category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            >
              {REPORT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Baris 2: Judul, Shift, Staf Hadir, Status (Admin) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 sm:gap-5">
          <div className={isAdmin ? 'sm:col-span-2 lg:col-span-5' : 'sm:col-span-2 lg:col-span-6'}>
            <label htmlFor="report-title" className="block text-sm font-medium text-slate-700">
              Judul Kegiatan
            </label>
            <input
              id="report-title"
              type="text"
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Briefing Pagi, Pengecekan Stok & Operasional Shift"
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <div className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <label htmlFor="report-shift" className="block text-sm font-medium text-slate-700">
              Shift
            </label>
            <select
              id="report-shift"
              required
              value={shift}
              onChange={(e) => setShift(e.target.value as ReportShift)}
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            >
              {REPORT_SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <label htmlFor="report-staff" className="block text-sm font-medium text-slate-700">
              Staf Hadir
            </label>
            <input
              id="report-staff"
              type="number"
              min={0}
              step="1"
              required
              value={staffPresent}
              onChange={(e) => setStaffPresent(e.target.value)}
              placeholder="0"
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          {isAdmin && (
            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="report-status" className="block text-sm font-medium text-slate-700">
                Status Tinjauan
              </label>
              <select
                id="report-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ReportStatus)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              >
                {REPORT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Baris 3: Uraian Kegiatan & Kendala */}
        <div className="space-y-4 sm:space-y-5 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="report-summary" className="block text-sm font-medium text-slate-700">
              Uraian Kegiatan & Capaian
            </label>
            <textarea
              id="report-summary"
              rows={4}
              required
              minLength={5}
              maxLength={3000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Tuliskan rangkaian kegiatan yang dilaksanakan, progres pekerjaan, kondisi operasional, serta catatan penting hari ini..."
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <div>
            <label htmlFor="report-issues" className="block text-sm font-medium text-slate-700">
              Kendala / Tindak Lanjut <span className="text-slate-400 font-normal">(Opsional)</span>
            </label>
            <textarea
              id="report-issues"
              rows={3}
              maxLength={2000}
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              placeholder="Catat kendala teknis, kebutuhan koordinasi, atau tindak lanjut yang diperlukan..."
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Batal
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <Save className="w-4 h-4 shrink-0" />
            <span>
              {submitting
                ? 'Menyimpan...'
                : editingReport
                  ? 'Simpan Perubahan'
                  : 'Kirim Laporan'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
