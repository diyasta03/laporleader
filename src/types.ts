export type UserRole = 'admin' | 'leader';

export type ReportCategory =
  | 'Operasional & Layanan Fisioterapi'
  | 'Sharing Session'
  | 'WM Class & Program Wellness'
  | 'Briefing & Evaluasi Tim'
  | 'Event & Aktivasi Komunitas'
  | 'Perawatan Alat & Fasilitas'
  | 'Kendala & Insiden';

export type ReportStatus = 'Under Review' | 'Reviewed';

export const REPORT_CATEGORIES: ReportCategory[] = [
  'Operasional & Layanan Fisioterapi',
  'Sharing Session',
  'WM Class & Program Wellness',
  'Briefing & Evaluasi Tim',
  'Event & Aktivasi Komunitas',
  'Perawatan Alat & Fasilitas',
  'Kendala & Insiden',
];

export const REPORT_STATUSES: ReportStatus[] = ['Under Review', 'Reviewed'];

export const WM_ADMIN_DOMAIN = '@wmcenter.id';
export const MAX_PDF_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
}

export interface UserProfile {
  id: string;
  /** Email @wmcenter.id untuk Admin, atau username untuk Leader */
  identifier: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  createdAt: string;
}

export interface ReportAttachmentInput {
  fileName: string;
  mimeType: 'application/pdf';
  dataBase64: string;
}

export interface BranchReport {
  id: string;
  reportDate: string;
  startTime: string;
  endTime: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  category: ReportCategory;
  activityName: string;
  sharingSessionTitle: string;
  description: string;
  achievements: string;
  issues: string;
  followUp: string;
  hasAttachment: boolean;
  attachmentName: string;
  attachmentSize: number;
  status: ReportStatus;
  reviewNote: string;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ReportPayload {
  reportDate: string;
  startTime: string;
  endTime: string;
  branchId: string;
  category: ReportCategory;
  activityName: string;
  sharingSessionTitle: string;
  description: string;
  achievements: string;
  issues: string;
  followUp: string;
  attachment?: ReportAttachmentInput | null;
  removeAttachment?: boolean;
  status?: ReportStatus;
  reviewNote?: string;
}

export interface AuthBootstrapStatus {
  needsSetup: boolean;
  hasEnvAdmin: boolean;
  backendMode: 'local' | 'appscript';
  appsScriptConfigured: boolean;
  adminEmailDomain: string;
}

export interface AppScriptConfigState {
  mode: 'local' | 'appscript';
  url: string;
  fromEnv: boolean;
  hasSharedSecret: boolean;
}
