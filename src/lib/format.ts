import type { BranchReport, ReportStatus } from '../types';

const numberFormatter = new Intl.NumberFormat('id-ID');

export function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
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

export function getStatusTextClass(status: ReportStatus): string {
  switch (status) {
    case 'Selesai':
      return 'text-emerald-700 font-medium';
    case 'Ditinjau':
      return 'text-amber-700 font-medium';
    case 'Perlu Revisi':
      return 'text-rose-700 font-medium';
    case 'Terkirim':
    default:
      return 'text-slate-600 font-medium';
  }
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeCsvCell(value: unknown): string {
  let str = String(value ?? '');
  // Cegah formula injection saat dibuka di Excel / Google Sheets
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
    'Kode Cabang',
    'Nama Cabang',
    'Judul Kegiatan',
    'Kategori',
    'Shift',
    'Staf Hadir',
    'Status',
    'Pelapor',
    'Uraian Kegiatan',
    'Kendala',
  ];

  const rows = reports.map((r) => [
    r.id,
    r.reportDate,
    r.branchCode,
    r.branchName,
    r.title,
    r.category,
    r.shift,
    r.staffPresent,
    r.status,
    r.createdByName,
    r.summary,
    r.issues,
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
