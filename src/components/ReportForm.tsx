import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_PDF_ATTACHMENT_BYTES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  type Branch,
  type BranchReport,
  type ReportAttachmentInput,
  type ReportCategory,
  type ReportPayload,
  type ReportStatus,
  type UserProfile,
} from '../types';
import { formatFileSize, getTodayIsoDate } from '../lib/format';

interface ReportFormProps {
  user: UserProfile;
  branches: Branch[];
  editingReport?: BranchReport | null;
  onSubmit: (payload: ReportPayload, editId?: string) => Promise<void>;
  onCancel?: () => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIndex = result.indexOf(',');
      if (commaIndex === -1) {
        reject(new Error('Gagal membaca file PDF.'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(new Error('Gagal membaca file PDF.'));
    reader.readAsDataURL(file);
  });
}

export function ReportForm({
  user,
  branches,
  editingReport,
  onSubmit,
  onCancel,
}: ReportFormProps) {
  const isAdmin = user.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const defaultBranchId =
    editingReport?.branchId ??
    (isAdmin ? branches[0]?.id ?? '' : user.branchId ?? '');

  const [reportDate, setReportDate] = useState(
    editingReport?.reportDate ?? getTodayIsoDate()
  );
  const [startTime, setStartTime] = useState(editingReport?.startTime ?? '08:30');
  const [endTime, setEndTime] = useState(editingReport?.endTime ?? '10:00');
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [category, setCategory] = useState<ReportCategory>(
    editingReport?.category ?? 'Operasional & Layanan Fisioterapi'
  );
  const [activityName, setActivityName] = useState(editingReport?.activityName ?? '');
  const [sharingSessionTitle, setSharingSessionTitle] = useState(
    editingReport?.sharingSessionTitle ?? ''
  );
  const [description, setDescription] = useState(editingReport?.description ?? '');
  const [achievements, setAchievements] = useState(editingReport?.achievements ?? '');
  const [issues, setIssues] = useState(editingReport?.issues ?? '');
  const [followUp, setFollowUp] = useState(editingReport?.followUp ?? '');
  const [status, setStatus] = useState<ReportStatus>(
    editingReport?.status ?? 'Under Review'
  );
  const [reviewNote, setReviewNote] = useState(editingReport?.reviewNote ?? '');

  // State Lampiran PDF (khusus Sharing Session)
  const [newPdfFile, setNewPdfFile] = useState<{
    fileName: string;
    size: number;
    dataBase64: string;
  } | null>(null);
  const [removeExistingPdf, setRemoveExistingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isSharingSession = category === 'Sharing Session';
  const hasExistingPdf =
    Boolean(editingReport?.hasAttachment) && !removeExistingPdf && !newPdfFile;

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(isAdmin ? branches[0].id : user.branchId ?? branches[0].id);
    }
  }, [branches, branchId, isAdmin, user.branchId]);

  // Validasi live: seluruh kolom wajib diisi sebelum tombol kirim aktif
  const missingRequirements = useMemo(() => {
    const missing: string[] = [];
    const targetBranch = isAdmin ? branchId : user.branchId ?? '';

    if (!targetBranch) missing.push('Cabang');
    if (!reportDate) missing.push('Tanggal');
    if (!startTime || !endTime) {
      missing.push('Jam kegiatan');
    } else if (endTime <= startTime) {
      missing.push('Jam selesai harus setelah jam mulai');
    }
    if (activityName.trim().length < 3) missing.push('Kegiatan hari ini');
    if (isSharingSession && sharingSessionTitle.trim().length < 3) {
      missing.push('Judul Sharing Session');
    }
    if (description.trim().length < 5) missing.push('Uraian kegiatan');
    if (achievements.trim().length < 3) missing.push('Capaian');
    if (issues.trim().length < 3) missing.push('Kendala');
    if (followUp.trim().length < 3) missing.push('Tindak lanjut');

    return missing;
  }, [
    isAdmin,
    branchId,
    user.branchId,
    reportDate,
    startTime,
    endTime,
    activityName,
    isSharingSession,
    sharingSessionTitle,
    description,
    achievements,
    issues,
    followUp,
  ]);

  const isFormComplete = missingRequirements.length === 0 && !pdfError;

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setPdfError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdfMime = file.type === 'application/pdf';
    const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
    if (!isPdfMime && !isPdfExt) {
      setPdfError('Hanya file berformat PDF (.pdf) yang diperbolehkan.');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_PDF_ATTACHMENT_BYTES) {
      setPdfError('Ukuran file PDF maksimal 5 MB.');
      e.target.value = '';
      return;
    }

    try {
      const dataBase64 = await readFileAsBase64(file);
      setNewPdfFile({
        fileName: file.name,
        size: file.size,
        dataBase64,
      });
      setRemoveExistingPdf(false);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Gagal membaca file PDF.');
    }
  }

  function handleClearPdf() {
    setNewPdfFile(null);
    setPdfError(null);
    if (editingReport?.hasAttachment) {
      setRemoveExistingPdf(true);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!isFormComplete) {
      setError(`Mohon lengkapi seluruh kolom wajib terlebih dahulu: ${missingRequirements.join(', ')}.`);
      return;
    }

    setSubmitting(true);
    try {
      let attachment: ReportAttachmentInput | null | undefined;
      if (isSharingSession && newPdfFile) {
        attachment = {
          fileName: newPdfFile.fileName,
          mimeType: 'application/pdf',
          dataBase64: newPdfFile.dataBase64,
        };
      }

      const payload: ReportPayload = {
        reportDate,
        startTime,
        endTime,
        branchId: isAdmin ? branchId : user.branchId ?? '',
        category,
        activityName: activityName.trim(),
        sharingSessionTitle: isSharingSession ? sharingSessionTitle.trim() : '',
        description: description.trim(),
        achievements: achievements.trim(),
        issues: issues.trim(),
        followUp: followUp.trim(),
        ...(attachment ? { attachment } : {}),
        ...(removeExistingPdf ? { removeAttachment: true } : {}),
        ...(isAdmin ? { status, reviewNote: reviewNote.trim() } : {}),
      };

      await onSubmit(payload, editingReport?.id);

      if (!editingReport) {
        setActivityName('');
        setSharingSessionTitle('');
        setDescription('');
        setAchievements('');
        setIssues('');
        setFollowUp('');
        setReviewNote('');
        setNewPdfFile(null);
        setRemoveExistingPdf(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setSuccessMsg('Laporan kegiatan berhasil dikirim dengan status Under Review.');
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
          <h2 className="text-base sm:text-lg font-semibold text-[#0A172E]">
            {editingReport
              ? `Ubah Laporan ${editingReport.id}`
              : isAdmin
                ? 'Form Laporan Kegiatan Semua Cabang'
                : 'Form Laporan Kegiatan Harian'}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            {isAdmin
              ? 'Semua kolom laporan wajib diisi lengkap sebelum dikirim.'
              : `Cabang penempatan: ${user.branchName ?? '-'} (${user.branchCode ?? '-'}). Semua kolom wajib diisi.`}
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

      <form onSubmit={handleFormSubmit} className="p-4 sm:p-6 space-y-6">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="rounded-md border border-[#033367]/20 bg-[#033367]/5 px-4 py-3 text-sm text-[#033367]"
          >
            {successMsg}
          </div>
        )}

        {/* Bagian 1: Identitas Cabang & Waktu Pelaksanaan */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5">
          <div className="md:col-span-4">
            <label htmlFor="report-branch" className="block text-sm font-medium text-[#0A172E]">
              Cabang WM Center <span className="text-rose-600">*</span>
            </label>
            {isAdmin ? (
              <select
                id="report-branch"
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-1.5 min-h-[44px] flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#0A172E]">
                <span className="truncate font-medium">
                  {user.branchCode} — {user.branchName}
                </span>
                <span className="text-xs text-slate-400 shrink-0 ml-2">Terkunci</span>
              </div>
            )}
          </div>

          <div className="md:col-span-4">
            <label htmlFor="report-date" className="block text-sm font-medium text-[#0A172E]">
              Tanggal Kegiatan <span className="text-rose-600">*</span>
            </label>
            <input
              id="report-date"
              type="date"
              required
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>

          <div className="md:col-span-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="report-start" className="block text-sm font-medium text-[#0A172E]">
                Jam Mulai <span className="text-rose-600">*</span>
              </label>
              <input
                id="report-start"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              />
            </div>

            <div>
              <label htmlFor="report-end" className="block text-sm font-medium text-[#0A172E]">
                Jam Selesai <span className="text-rose-600">*</span>
              </label>
              <input
                id="report-end"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              />
            </div>
          </div>
        </div>

        {startTime && endTime && endTime <= startTime && (
          <p className="text-xs text-rose-700 -mt-3">
            Jam selesai harus lebih akhir daripada jam mulai.
          </p>
        )}

        {/* Bagian 2: Kategori Kegiatan, Nama Kegiatan & Tambahan Khusus Sharing Session */}
        <div className="pt-5 border-t border-slate-200 space-y-4 sm:space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5">
            <div className="md:col-span-5">
              <label htmlFor="report-category" className="block text-sm font-medium text-[#0A172E]">
                Kategori Kegiatan <span className="text-rose-600">*</span>
              </label>
              <select
                id="report-category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              >
                {REPORT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-7">
              <label htmlFor="report-activity" className="block text-sm font-medium text-[#0A172E]">
                Kegiatan Hari Ini <span className="text-rose-600">*</span>
              </label>
              <input
                id="report-activity"
                type="text"
                required
                minLength={3}
                maxLength={180}
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                placeholder={
                  isSharingSession
                    ? 'Contoh: Sharing Session Klinis Mingguan Tim Fisioterapis'
                    : 'Contoh: Pelayanan Fisioterapi, WM Class Lansia, atau Briefing Tim'
                }
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              />
            </div>
          </div>

          {/* Input Tambahan Khusus Sharing Session: Judul + Lampiran PDF */}
          {isSharingSession && (
            <div className="rounded-md border border-[#033367]/25 bg-[#F7F9FC] p-4 space-y-4">
              <div>
                <label
                  htmlFor="report-sharing-title"
                  className="block text-sm font-semibold text-[#033367]"
                >
                  Judul Sharing Session <span className="text-rose-600">*</span>
                </label>
                <p className="mt-0.5 text-xs text-slate-600">
                  Wajib diisi untuk mendokumentasikan topik atau materi Sharing Session yang dibawakan.
                </p>
                <input
                  id="report-sharing-title"
                  type="text"
                  required
                  minLength={3}
                  maxLength={180}
                  value={sharingSessionTitle}
                  onChange={(e) => setSharingSessionTitle(e.target.value)}
                  placeholder="Contoh: Protokol Pemulihan Cedera ACL Fase Awal pada Atlet Lari"
                  className="mt-2 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                />
              </div>

              <div className="pt-3 border-t border-slate-200">
                <label
                  htmlFor="report-sharing-pdf"
                  className="block text-sm font-semibold text-[#033367]"
                >
                  Lampiran File PDF Sharing Session{' '}
                  <span className="font-normal text-slate-500">(Format .pdf, maks. 5 MB)</span>
                </label>
                <p className="mt-0.5 text-xs text-slate-600">
                  Lampirkan slide materi, modul studi kasus, atau ringkasan Sharing Session dalam format PDF.
                </p>

                <div className="mt-2.5">
                  {newPdfFile ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#033367]/25 bg-white px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#0A172E] truncate">
                          {newPdfFile.fileName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          PDF · {formatFileSize(newPdfFile.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearPdf}
                        className="text-xs font-medium text-rose-700 hover:underline whitespace-nowrap"
                      >
                        Hapus File
                      </button>
                    </div>
                  ) : hasExistingPdf && editingReport ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#0A172E] truncate">
                          {editingReport.attachmentName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Lampiran tersimpan · {formatFileSize(editingReport.attachmentSize)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <label
                          htmlFor="report-sharing-pdf"
                          className="cursor-pointer text-xs font-medium text-[#033367] hover:underline whitespace-nowrap"
                        >
                          Ganti PDF
                        </label>
                        <button
                          type="button"
                          onClick={handleClearPdf}
                          className="text-xs font-medium text-rose-700 hover:underline whitespace-nowrap"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <input
                    ref={fileInputRef}
                    id="report-sharing-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handlePdfSelect}
                    className={`${
                      newPdfFile || hasExistingPdf ? 'sr-only' : 'block'
                    } w-full text-xs text-slate-600 file:mr-3 file:min-h-[38px] file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3.5 file:py-1.5 file:text-xs file:font-semibold file:text-[#033367] hover:file:bg-slate-50`}
                  />

                  {pdfError && (
                    <p role="alert" className="mt-1.5 text-xs text-rose-700">
                      {pdfError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bagian 3: Uraian Kegiatan, Capaian, Kendala & Tindak Lanjut (Semua Wajib Diisi) */}
        <div className="pt-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          <div>
            <label htmlFor="report-desc" className="block text-sm font-medium text-[#0A172E]">
              Uraian Kegiatan <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="report-desc"
              rows={4}
              required
              minLength={5}
              maxLength={3000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan rangkaian pelaksanaan kegiatan, peserta/tim yang terlibat, dan jalannya sesi..."
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>

          <div>
            <label htmlFor="report-achieve" className="block text-sm font-medium text-[#0A172E]">
              Capaian <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="report-achieve"
              rows={4}
              required
              minLength={3}
              maxLength={2000}
              value={achievements}
              onChange={(e) => setAchievements(e.target.value)}
              placeholder="Tuliskan hasil konkret yang tercapai dari kegiatan hari ini..."
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>

          <div>
            <label htmlFor="report-issues" className="block text-sm font-medium text-[#0A172E]">
              Kendala <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="report-issues"
              rows={3}
              required
              minLength={3}
              maxLength={2000}
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              placeholder='Catat hambatan alat, fasilitas, jadwal, atau tulis "Tidak ada kendala" jika berjalan lancar...'
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>

          <div>
            <label htmlFor="report-followup" className="block text-sm font-medium text-[#0A172E]">
              Tindak Lanjut <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="report-followup"
              rows={3}
              required
              minLength={3}
              maxLength={2000}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Tuliskan rencana aksi, PIC, atau langkah evaluasi berikutnya..."
              className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
            />
          </div>
        </div>

        {/* Bagian 4: Status & Catatan Review (Khusus Admin) */}
        {isAdmin && (
          <div className="pt-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5">
            <div className="md:col-span-4">
              <label htmlFor="report-status" className="block text-sm font-medium text-[#0A172E]">
                Status Review
              </label>
              <select
                id="report-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ReportStatus)}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              >
                {REPORT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-8">
              <label htmlFor="report-note" className="block text-sm font-medium text-[#0A172E]">
                Catatan Review Admin <span className="text-slate-400 font-normal">(Opsional)</span>
              </label>
              <input
                id="report-note"
                type="text"
                maxLength={1000}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Tambahkan arahan atau catatan tinjauan untuk Leader cabang..."
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
              />
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {!isFormComplete ? (
              <span>
                Lengkapi kolom wajib terlebih dahulu:{' '}
                <span className="text-[#0A172E] font-medium">
                  {missingRequirements.slice(0, 3).join(', ')}
                  {missingRequirements.length > 3
                    ? ` (+${missingRequirements.length - 3} lainnya)`
                    : ''}
                </span>
              </span>
            ) : (
              <span className="text-[#033367] font-medium">
                Seluruh kolom wajib telah terisi. Laporan siap dikirim.
              </span>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2.5 sm:gap-3 shrink-0">
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
              disabled={submitting || !isFormComplete}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-medium text-white bg-[#033367] rounded-md hover:bg-[#0A172E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#033367] focus-visible:ring-offset-2 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {submitting
                ? 'Menyimpan...'
                : editingReport
                  ? 'Simpan Perubahan'
                  : 'Kirim Laporan'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
