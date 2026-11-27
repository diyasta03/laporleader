import type { BranchReport, ReportStatus } from '../types';

const numberFormatter = new Intl.NumberFormat('id-ID');

export function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

export function formatDateId(dateStr: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatShortDateId(dateStr: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function formatDateTimeId(isoStr: string): string {
  if (!isoStr) return '-';
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTimeRange(startTime: string, endTime: string): string {
  if (!startTime && !endTime) return '-';
  if (startTime && endTime) return `${startTime} – ${endTime}`;
  return startTime || endTime;
}

export function getStatusTextClass(status: ReportStatus): string {
  return status === 'Reviewed'
    ? 'text-[#033367] font-semibold'
    : 'text-amber-700 font-medium';
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Mengidentifikasi apakah kolom Kendala melaporkan hambatan nyata
 * (karena kolom Kendala wajib diisi, pelapor sering menulis "Tidak ada kendala" / "Nihil").
 */
export function hasReportedIssue(issues: string): boolean {
  const normalized = issues.trim().toLowerCase().replace(/[.,!]/g, '');
  if (!normalized || normalized === '-') return false;
  if (
    /^(tidak ada( kendala| hambatan| masalah)?|nihil|belum ada( kendala)?|none|aman|lancar|tanpa kendala)$/i.test(
      normalized
    )
  ) {
    return false;
  }
  return true;
}

function escapeCsvCell(value: unknown): string {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function downloadReportsCsv(reports: BranchReport[], filename: string): void {
  const headers = [
    'ID Laporan',
    'Tanggal',
    'Jam Mulai',
    'Jam Selesai',
    'Kode Cabang',
    'Nama Cabang',
    'Kategori Kegiatan',
    'Nama Kegiatan',
    'Judul Sharing Session',
    'Lampiran PDF',
    'Uraian Kegiatan',
    'Capaian',
    'Kendala',
    'Tindak Lanjut',
    'Status',
    'Catatan Review',
    'Pelapor',
  ];

  const rows = reports.map((r) => [
    r.id,
    r.reportDate,
    r.startTime,
    r.endTime,
    r.branchCode,
    r.branchName,
    r.category,
    r.activityName,
    r.sharingSessionTitle,
    r.hasAttachment ? r.attachmentName : '',
    r.description,
    r.achievements,
    r.issues,
    r.followUp,
    r.status,
    r.reviewNote,
    r.createdByName,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
