export type UserRole = 'admin' | 'leader';

export type ReportCategory =
  | 'Operasional Harian'
  | 'Pelayanan & Lapangan'
  | 'Stok & Logistik'
  | 'SDM & Kehadiran'
  | 'Kendala & Insiden';

export type ReportShift = 'Pagi' | 'Siang' | 'Malam' | 'Penuh';

export type ReportStatus =
  | 'Terkirim'
  | 'Ditinjau'
  | 'Selesai'
  | 'Perlu Revisi';

export const REPORT_CATEGORIES: ReportCategory[] = [
  'Operasional Harian',
  'Pelayanan & Lapangan',
  'Stok & Logistik',
  'SDM & Kehadiran',
  'Kendala & Insiden',
];

export const REPORT_SHIFTS: ReportShift[] = ['Pagi', 'Siang', 'Malam', 'Penuh'];

export const REPORT_STATUSES: ReportStatus[] = [
  'Terkirim',
  'Ditinjau',
  'Selesai',
  'Perlu Revisi',
];

export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
}

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  createdAt: string;
}

export interface BranchReport {
  id: string;
  reportDate: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  title: string;
  category: ReportCategory;
  shift: ReportShift;
  staffPresent: number;
  summary: string;
  issues: string;
  status: ReportStatus;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ReportPayload {
  reportDate: string;
  branchId: string;
  title: string;
  category: ReportCategory;
  shift: ReportShift;
  staffPresent: number;
  summary: string;
  issues: string;
  status?: ReportStatus;
}

export interface AuthBootstrapStatus {
  needsSetup: boolean;
  hasEnvAdmin: boolean;
  backendMode: 'local' | 'appscript';
  appsScriptConfigured: boolean;
}

export interface AppScriptConfigState {
  mode: 'local' | 'appscript';
  url: string;
  fromEnv: boolean;
  hasSharedSecret: boolean;
}
