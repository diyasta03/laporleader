import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  Branch,
  BranchReport,
  ReportCategory,
  ReportStatus,
  UserProfile,
  UserRole,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam
const ADMIN_EMAIL_DOMAIN = '@wmcenter.id';

const ALLOWED_CATEGORIES = new Set<ReportCategory>([
  'Operasional & Layanan Fisioterapi',
  'Sharing Session',
  'WM Class & Program Wellness',
  'Briefing & Evaluasi Tim',
  'Event & Aktivasi Komunitas',
  'Perawatan Alat & Fasilitas',
  'Kendala & Insiden',
]);

const ALLOWED_STATUSES = new Set<ReportStatus>(['Under Review', 'Reviewed']);

interface StoredUser {
  id: string;
  identifier: string; // email @wmcenter.id untuk admin, username untuk leader
  fullName: string;
  role: UserRole;
  branchId: string | null;
  secretSalt: string;
  secretHash: string;
  createdAt: string;
}

interface SessionRecord {
  userId: string;
  appsScriptToken?: string;
  userSnapshot?: UserProfile;
  expiresAt: number;
}

/* ==================== SECRET HASHING (SCRYPT) ==================== */

function hashSecret(secret: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifySecret(secret: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashSecret(secret, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function isValidWmAdminEmail(email: string): boolean {
  return /^[a-z0-9._%+-]+@wmcenter\.id$/i.test(email) && email.length <= 120;
}

function normalizeUsername(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

/* ==================== SSRF-SAFE APPS SCRIPT PROXY ==================== */

const APPS_SCRIPT_EXEC_PATH = /^\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
const ALLOWED_REDIRECT_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);

function validateAppsScriptUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Format URL Apps Script tidak valid.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('URL Apps Script wajib menggunakan protokol HTTPS.');
  }
  if (parsed.hostname !== 'script.google.com') {
    throw new Error('Host URL harus berasal dari script.google.com.');
  }
  if (!APPS_SCRIPT_EXEC_PATH.test(parsed.pathname)) {
    throw new Error(
      'Path URL harus berupa Web App deployment Google Apps Script (/macros/s/.../exec).'
    );
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error('URL Apps Script tidak boleh mengandung kredensial atau port khusus.');
  }

  return parsed;
}

async function fetchAppsScriptSafe(
  targetUrl: string,
  init: { method: 'GET' | 'POST'; body?: string }
): Promise<unknown> {
  let currentUrl = validateAppsScriptUrl(targetUrl);
  let method: 'GET' | 'POST' = init.method;
  let body = init.body;

  for (let hop = 0; hop < 4; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(currentUrl.toString(), {
        method,
        headers:
          method === 'POST'
            ? { 'Content-Type': 'text/plain;charset=utf-8' }
            : { Accept: 'application/json' },
        body: method === 'POST' ? body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Redirect Apps Script tidak menyertakan lokasi tujuan.');
        }
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.protocol !== 'https:' || !ALLOWED_REDIRECT_HOSTS.has(nextUrl.hostname)) {
          throw new Error('Redirect tujuan tidak diizinkan oleh kebijakan keamanan.');
        }
        currentUrl = nextUrl;
        method = 'GET';
        body = undefined;
        continue;
      }

      const rawText = await response.text();
      try {
        return JSON.parse(rawText);
      } catch {
        if (/Script function not found:\s*doPost/i.test(rawText)) {
          throw new Error(
            'Fungsi doPost belum ditemukan di Web App Apps Script. Pastikan kode Code.gs sudah ditempel & disimpan, lalu klik Deploy → Manage deployments → Edit → New version.'
          );
        }
        if (/Script function not found:\s*doGet/i.test(rawText)) {
          throw new Error(
            'Fungsi doGet belum ditemukan di Web App Apps Script. Pastikan seluruh kode Code.gs sudah ditempel lalu deploy versi baru.'
          );
        }
        if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(rawText)) {
          throw new Error(
            'Google Apps Script meminta login Google. Ubah pengaturan deployment "Who has access" menjadi "Anyone".'
          );
        }
        throw new Error(
          'Respons Apps Script bukan JSON valid. Pastikan kode Code.gs sudah terpasang, jalankan setupSpreadsheet(), dan atur deployment Web App ke "Anyone".'
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Terlalu banyak pengalihan (redirect) dari Google Apps Script.');
}

/* ==================== WM CENTER LOCAL STORE ==================== */

const branches: Branch[] = [
  {
    id: 'wm-snt',
    code: 'WM-SNT',
    name: 'WM Center Sunter',
    city: 'Jakarta Utara',
    address: 'Kawasan Sunter Agung, Jakarta Utara',
  },
  {
    id: 'wm-pmd',
    code: 'WM-PMD',
    name: 'WM Center Pemuda',
    city: 'Jakarta Timur',
    address: 'Jl. Pemuda, Rawamangun, Jakarta Timur',
  },
  {
    id: 'wm-kby',
    code: 'WM-KBY',
    name: 'WM Center Kebayoran',
    city: 'Jakarta Selatan',
    address: 'Kebayoran Baru, Jakarta Selatan',
  },
  {
    id: 'wm-kmg',
    code: 'WM-KMG',
    name: 'WM Center Kemang',
    city: 'Jakarta Selatan',
    address: 'Kawasan Kemang, Jakarta Selatan',
  },
  {
    id: 'wm-kng',
    code: 'WM-KNG',
    name: 'WM Center Kuningan',
    city: 'Jakarta Selatan',
    address: 'Kuningan, Jakarta Selatan',
  },
  {
    id: 'wm-pri',
    code: 'WM-PRI',
    name: 'WM Center Puri',
    city: 'Jakarta Barat',
    address: 'Puri Indah, Jakarta Barat',
  },
  {
    id: 'wm-als',
    code: 'WM-ALS',
    name: 'WM Center Alam Sutera',
    city: 'Tangerang',
    address: 'Kawasan Alam Sutera, Tangerang',
  },
  {
    id: 'wm-bsd',
    code: 'WM-BSD',
    name: 'WM Center BSD',
    city: 'Tangerang Selatan',
    address: 'BSD City, Tangerang Selatan',
  },
  {
    id: 'wm-bks',
    code: 'WM-BKS',
    name: 'WM Center Bekasi',
    city: 'Bekasi',
    address: 'Bekasi Barat, Kota Bekasi',
  },
  {
    id: 'wm-dpk',
    code: 'WM-DPK',
    name: 'WM Center Depok',
    city: 'Depok',
    address: 'Margonda, Kota Depok',
  },
  {
    id: 'wm-bdg',
    code: 'WM-BDG',
    name: 'WM Center Bandung',
    city: 'Bandung',
    address: 'Kota Bandung, Jawa Barat',
  },
  {
    id: 'wm-sby',
    code: 'WM-SBY',
    name: 'WM Center Surabaya',
    city: 'Surabaya',
    address: 'Kota Surabaya, Jawa Timur',
  },
];

const users: StoredUser[] = [];
const sessions = new Map<string, SessionRecord>();
const attachments = new Map<string, { fileName: string; buffer: Buffer }>();
const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

function buildMinimalSamplePdf(title: string, subtitle: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, ' ');
  const safeSubtitle = subtitle.replace(/[()\\]/g, ' ');
  const stream = `BT\n/F1 16 Tf\n56 760 Td\n(${safeTitle}) Tj\n0 -24 Td\n/F1 11 Tf\n(${safeSubtitle}) Tj\n0 -28 Td\n(Dokumen materi Sharing Session - WM Center Wellness Medical Center) Tj\nET`;
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'utf8');
}

const sampleAclPdf = buildMinimalSamplePdf(
  'WM Center - Sharing Session Klinis',
  'Protokol Pemulihan Cedera ACL Fase Awal pada Atlet Lari'
);
attachments.set('WM-20261126-A101', {
  fileName: 'Protokol-Pemulihan-ACL-Fase-Awal.pdf',
  buffer: sampleAclPdf,
});

const reports: BranchReport[] = [
  {
    id: 'WM-20261126-A101',
    reportDate: '2026-11-26',
    startTime: '08:30',
    endTime: '10:00',
    branchId: 'wm-snt',
    branchName: 'WM Center Sunter',
    branchCode: 'WM-SNT',
    category: 'Sharing Session',
    activityName: 'Sharing Session Klinis Tim Fisioterapis Sunter',
    sharingSessionTitle: 'Protokol Pemulihan Cedera ACL Fase Awal pada Atlet Lari',
    description:
      'Diskusi kasus penanganan pasien pasca-rekonstruksi ACL minggu ke-2 hingga ke-6 bersama seluruh fisioterapis dan asisten terapis sebelum sesi klinik dimulai.',
    achievements:
      'Seluruh 12 fisioterapis menyepakati standar latihan aktivasi quadriceps dan parameter evaluasi nyeri yang seragam di ruang gym rehab.',
    issues: 'Materi video latihan belum terunggah ke folder referensi internal cabang.',
    followUp: 'Leader cabang mengunggah rangkuman slide dan video latihan ke Google Drive tim hari ini pukul 17.00 WIB.',
    hasAttachment: true,
    attachmentName: 'Protokol-Pemulihan-ACL-Fase-Awal.pdf',
    attachmentSize: sampleAclPdf.length,
    status: 'Reviewed',
    reviewNote: 'Materi sangat relevan, silakan bagikan ke grup leader cabang lain.',
    createdById: 'seed-snt',
    createdByName: 'dr. Raka Pratama',
    createdByRole: 'leader',
    createdAt: '2026-11-26T03:15:00.000Z',
    updatedAt: '2026-11-26T04:00:00.000Z',
  },
  {
    id: 'WM-20261126-B204',
    reportDate: '2026-11-26',
    startTime: '09:00',
    endTime: '16:30',
    branchId: 'wm-kmg',
    branchName: 'WM Center Kemang',
    branchCode: 'WM-KMG',
    category: 'Operasional & Layanan Fisioterapi',
    activityName: 'Pelayanan Sesi Fisioterapi & Evaluasi Antrean Pasien',
    sharingSessionTitle: '',
    description:
      'Pelaksanaan jadwal treatment fisioterapi rutin dan sesi sports recovery sepanjang hari di 6 ruang terapi aktif.',
    achievements:
      '38 sesi pasien tertangani tepat waktu dengan waktu tunggu rata-rata di bawah 8 menit.',
    issues: 'Satu unit alat ultrasound terapi di Ruang 3 menunjukkan sensor suhu tidak stabil pada sesi sore.',
    followUp: 'Ruang 3 sementara memakai unit cadangan dan tiket kalibrasi teknisi pusat sudah diajukan untuk besok pagi.',
    hasAttachment: false,
    attachmentName: '',
    attachmentSize: 0,
    status: 'Under Review',
    reviewNote: '',
    createdById: 'seed-kmg',
    createdByName: 'Nadia Kusuma',
    createdByRole: 'leader',
    createdAt: '2026-11-26T09:40:00.000Z',
    updatedAt: '2026-11-26T09:40:00.000Z',
  },
  {
    id: 'WM-20261125-C309',
    reportDate: '2026-11-25',
    startTime: '16:00',
    endTime: '17:30',
    branchId: 'wm-bsd',
    branchName: 'WM Center BSD',
    branchCode: 'WM-BSD',
    category: 'WM Class & Program Wellness',
    activityName: 'WM Class Mobility & Program Kebugaran Lansia',
    sharingSessionTitle: '',
    description:
      'Penyelenggaraan kelas latihan keseimbangan, penguatan core, dan fleksibilitas sendi untuk peserta program lansia di area studio BSD.',
    achievements:
      '18 peserta hadir penuh dan menyelesaikan seluruh rangkaian latihan dengan pendampingan 3 fisioterapis tanpa keluhan cedera.',
    issues: 'Tidak ada kendala.',
    followUp: 'Membuka jadwal kelas lanjutan untuk kelompok yang sama pada hari Jumat pagi.',
    hasAttachment: false,
    attachmentName: '',
    attachmentSize: 0,
    status: 'Reviewed',
    reviewNote: 'Pertahankan tingkat partisipasi peserta WM Class.',
    createdById: 'seed-bsd',
    createdByName: 'Dimas Saputra',
    createdByRole: 'leader',
    createdAt: '2026-11-25T11:05:00.000Z',
    updatedAt: '2026-11-25T12:10:00.000Z',
  },
  {
    id: 'WM-20261125-D412',
    reportDate: '2026-11-25',
    startTime: '13:00',
    endTime: '14:30',
    branchId: 'wm-bdg',
    branchName: 'WM Center Bandung',
    branchCode: 'WM-BDG',
    category: 'Sharing Session',
    activityName: 'Sharing Session Mingguan Terapis Cabang Bandung',
    sharingSessionTitle: 'Teknik Manual Therapy & Dry Needling untuk Nyeri Bahu (Frozen Shoulder)',
    description:
      'Sesi pemaparan studi kasus dan praktik langsung mobilisasi sendi glenohumeral oleh senior fisioterapis cabang Bandung.',
    achievements:
      '9 fisioterapis mengikuti praktik langsung dan menyelesaikan lembar evaluasi pemahaman teknik.',
    issues: 'Waktu sesi sedikit mundur 15 menit karena jadwal pasien siang padat.',
    followUp: 'Menjadwalkan sesi sharing minggu depan pada jam istirahat awal pukul 12.30 WIB.',
    hasAttachment: false,
    attachmentName: '',
    attachmentSize: 0,
    status: 'Under Review',
    reviewNote: '',
    createdById: 'seed-bdg',
    createdByName: 'Siti Rahmawati',
    createdByRole: 'leader',
    createdAt: '2026-11-25T08:15:00.000Z',
    updatedAt: '2026-11-25T08:15:00.000Z',
  },
  {
    id: 'WM-20261124-E518',
    reportDate: '2026-11-24',
    startTime: '07:00',
    endTime: '11:00',
    branchId: 'wm-sby',
    branchName: 'WM Center Surabaya',
    branchCode: 'WM-SBY',
    category: 'Event & Aktivasi Komunitas',
    activityName: 'Recovery Booth Bersama Komunitas Padel & Lari Surabaya',
    sharingSessionTitle: '',
    description:
      'Tim cabang membuka layanan sport massage, stretching pasca-latihan, dan konsultasi cedera singkat di lapangan komunitas.',
    achievements:
      '45 peserta komunitas mencoba layanan recovery dan 14 peserta mendaftar asesmen lanjutan di klinik WM Center Surabaya.',
    issues: 'Stok kinesio tape habis di satu jam terakhir acara.',
    followUp: 'Menambah kuota perlengkapan lapangan sebesar 30% untuk jadwal aktivasi komunitas bulan depan.',
    hasAttachment: false,
    attachmentName: '',
    attachmentSize: 0,
    status: 'Reviewed',
    reviewNote: 'Hasil konversi asesmen sangat baik.',
    createdById: 'seed-sby',
    createdByName: 'Fajar Hidayat',
    createdByRole: 'leader',
    createdAt: '2026-11-24T05:30:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
  },
  {
    id: 'WM-20261124-F622',
    reportDate: '2026-11-24',
    startTime: '08:00',
    endTime: '09:00',
    branchId: 'wm-als',
    branchName: 'WM Center Alam Sutera',
    branchCode: 'WM-ALS',
    category: 'Perawatan Alat & Fasilitas',
    activityName: 'Inspeksi Berkala Alat Elektroterapi & Kebersihan Ruang Rehab',
    sharingSessionTitle: '',
    description:
      'Pengecekan kabel elektroda TENS, kondisi matras latihan, serta sanitasi ruang terapi sebelum jam buka cabang.',
    achievements:
      'Seluruh 8 unit alat elektroterapi dan area gym rehab lulus checklist kesiapan harian.',
    issues: 'Dua pasang pad elektroda cadangan sudah mendekati batas pemakaian.',
    followUp: 'Permintaan pengadaan 10 pasang pad elektroda sudah dikirim ke bagian logistik pusat.',
    hasAttachment: false,
    attachmentName: '',
    attachmentSize: 0,
    status: 'Under Review',
    reviewNote: '',
    createdById: 'seed-als',
    createdByName: 'Bagas Mahendra',
    createdByRole: 'leader',
    createdAt: '2026-11-24T02:30:00.000Z',
    updatedAt: '2026-11-24T02:30:00.000Z',
  },
];

/* ==================== APPS SCRIPT RUNTIME CONFIG ==================== */

const APPS_SCRIPT_CONFIG_PATH = path.resolve(__dirname, 'data', 'appscript-config.json');

function loadPersistedAppsScriptConfig(): { mode: 'local' | 'appscript'; url: string } | null {
  try {
    if (!fs.existsSync(APPS_SCRIPT_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(APPS_SCRIPT_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { mode?: unknown; url?: unknown };
    const url = typeof parsed?.url === 'string' ? parsed.url.trim() : '';
    const mode = parsed?.mode === 'appscript' ? 'appscript' : 'local';
    if (url) {
      validateAppsScriptUrl(url);
    }
    if (mode === 'appscript' && !url) {
      return null;
    }
    return { mode, url };
  } catch {
    return null;
  }
}

function savePersistedAppsScriptConfig(mode: 'local' | 'appscript', url: string): void {
  try {
    const dir = path.dirname(APPS_SCRIPT_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      APPS_SCRIPT_CONFIG_PATH,
      JSON.stringify({ mode, url, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.warn('Gagal menyimpan konfigurasi Apps Script ke disk:', err);
  }
}

const envAppsScriptUrl = (process.env.APPS_SCRIPT_URL ?? '').trim();
let appsScriptState: {
  mode: 'local' | 'appscript';
  url: string;
  fromEnv: boolean;
} = {
  mode: 'local',
  url: '',
  fromEnv: false,
};

if (envAppsScriptUrl) {
  try {
    const validatedEnv = validateAppsScriptUrl(envAppsScriptUrl);
    appsScriptState = {
      mode: 'appscript',
      url: validatedEnv.toString(),
      fromEnv: true,
    };
  } catch {
    appsScriptState = { mode: 'local', url: '', fromEnv: false };
  }
} else {
  const persisted = loadPersistedAppsScriptConfig();
  if (persisted) {
    appsScriptState = {
      mode: persisted.mode,
      url: persisted.url,
      fromEnv: false,
    };
  }
}

/* ==================== ENV ADMIN BOOTSTRAP CHECK ==================== */

const envAdminPassword = (process.env.ADMIN_INITIAL_PASSWORD ?? '').trim();
const envAdminEmailRaw = normalizeEmail(process.env.ADMIN_INITIAL_EMAIL || 'admin@wmcenter.id');
const envAdminEmail = isValidWmAdminEmail(envAdminEmailRaw) ? envAdminEmailRaw : 'admin@wmcenter.id';

function ensureEnvAdminUser(): void {
  if (!envAdminPassword) return;
  const existing = users.find((u) => u.id === 'usr-env-admin');
  const { salt, hash } = hashSecret(envAdminPassword);
  if (existing) {
    existing.identifier = envAdminEmail;
    existing.secretSalt = salt;
    existing.secretHash = hash;
    return;
  }
  users.unshift({
    id: 'usr-env-admin',
    identifier: envAdminEmail,
    fullName: 'Admin WM Center',
    role: 'admin',
    branchId: null,
    secretSalt: salt,
    secretHash: hash,
    createdAt: new Date().toISOString(),
  });
}

ensureEnvAdminUser();

function toUserProfile(u: StoredUser): UserProfile {
  const branch = u.branchId ? branches.find((b) => b.id === u.branchId) ?? null : null;
  return {
    id: u.id,
    identifier: u.identifier,
    fullName: u.fullName,
    role: u.role,
    branchId: branch ? branch.id : null,
    branchName: branch ? branch.name : null,
    branchCode: branch ? branch.code : null,
    createdAt: u.createdAt,
  };
}

function hasAnyAdmin(): boolean {
  return users.some((u) => u.role === 'admin');
}

const SESSIONS_STORE_PATH = path.resolve(__dirname, 'data', 'sessions.json');

function loadPersistedSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_STORE_PATH)) return;
    const raw = fs.readFileSync(SESSIONS_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, SessionRecord>;
    const now = Date.now();
    for (const [token, rec] of Object.entries(parsed)) {
      if (rec && typeof rec.userId === 'string' && typeof rec.expiresAt === 'number' && rec.expiresAt > now) {
        sessions.set(token, rec);
      }
    }
  } catch {
    // abaikan jika file sesi belum ada atau rusak
  }
}

function savePersistedSessions(): void {
  try {
    const dir = path.dirname(SESSIONS_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const now = Date.now();
    const active: Record<string, SessionRecord> = {};
    for (const [token, rec] of sessions.entries()) {
      if (rec.expiresAt > now) {
        active[token] = rec;
      } else {
        sessions.delete(token);
      }
    }
    fs.writeFileSync(SESSIONS_STORE_PATH, JSON.stringify(active), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.warn('Gagal menyimpan sesi ke disk:', err);
  }
}

loadPersistedSessions();

function createLocalSession(userId: string, extra?: Partial<SessionRecord>): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    ...extra,
  });
  savePersistedSessions();
  return token;
}

const SESSION_COOKIE_NAME = 'wm_session';

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (req.secure || forwardedProto === 'https') return true;

  const forwarded = String(req.headers.forwarded ?? '').toLowerCase();
  if (forwarded.includes('proto=https')) return true;

  const origin = String(req.headers.origin ?? '').toLowerCase();
  if (origin.startsWith('https://')) return true;

  const referer = String(req.headers.referer ?? '').toLowerCase();
  if (referer.startsWith('https://')) return true;

  if (origin.startsWith('http://') || referer.startsWith('http://')) return false;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isLoopbackHost =
    host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
  if (!isLoopbackHost) return true;

  return String(process.env.APP_URL ?? '').trim().toLowerCase().startsWith('https://');
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const attrs = isHttpsRequest(req)
    ? `Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`);
}

function clearSessionCookie(req: Request, res: Response): void {
  const attrs = isHttpsRequest(req)
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${attrs}`);
}

function extractAuthCredentials(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, viaCookie: false };
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    return { token: cookieToken, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

function getAllowedHosts(req: Request): Set<string> {
  const allowed = new Set<string>();
  const addHost = (raw: string | undefined) => {
    const clean = String(raw ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (clean) allowed.add(clean);
  };
  addHost(String(req.headers['x-forwarded-host'] ?? ''));
  addHost(String(req.headers.host ?? ''));
  const appUrl = String(process.env.APP_URL ?? '').trim();
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host.toLowerCase());
    } catch {
      // abaikan APP_URL non-URL
    }
  }
  return allowed;
}

function isSafeCookieMutation(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  // Wajib menyertakan custom header X-Requested-With pada mutasi berbasis cookie
  const requestedWith = String(req.headers['x-requested-with'] ?? '').trim();
  if (requestedWith !== 'WM-Portal') {
    return false;
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const allowedHosts = getAllowedHosts(req);
      if (allowedHosts.size > 0 && !allowedHosts.has(originHost)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function resolveSessionUser(
  token: string
): { session: SessionRecord; user: UserProfile } | null {
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) {
      sessions.delete(token);
      savePersistedSessions();
    }
    return null;
  }

  if (appsScriptState.mode === 'appscript' && session.userSnapshot) {
    return { session, user: session.userSnapshot };
  }

  const stored = users.find((u) => u.id === session.userId);
  if (!stored) {
    sessions.delete(token);
    savePersistedSessions();
    return null;
  }

  return { session, user: toUserProfile(stored) };
}

interface AuthedRequest extends Request {
  authToken?: string;
  session?: SessionRecord;
  currentUser?: UserProfile;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const { token, viaCookie } = extractAuthCredentials(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan masuk terlebih dahulu.' });
    return;
  }

  if (viaCookie && !isSafeCookieMutation(req)) {
    res.status(403).json({ error: 'Permintaan ditolak oleh verifikasi asal sesi.' });
    return;
  }

  const resolved = resolveSessionUser(token);
  if (!resolved) {
    if (viaCookie) clearSessionCookie(req, res);
    res.status(401).json({ error: 'Sesi telah berakhir. Silakan masuk kembali.' });
    return;
  }

  req.authToken = token;
  req.session = resolved.session;
  req.currentUser = resolved.user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Akses ditolak. Fitur ini khusus untuk Admin WM Center.' });
    return;
  }
  next();
}

function sanitizePdfFileName(rawName: unknown): string {
  const base = path.basename(String(rawName ?? 'lampiran.pdf'));
  const cleaned = base
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 110);
  const withExt = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'lampiran'}.pdf`;
  return withExt;
}

function parseValidatedPdfAttachment(
  raw: unknown,
  category: ReportCategory
): { fileName: string; buffer: Buffer; dataBase64: string } | null {
  if (raw === null || raw === undefined) return null;
  if (category !== 'Sharing Session') {
    throw new Error('Lampiran PDF hanya tersedia untuk kategori Sharing Session.');
  }
  if (typeof raw !== 'object') {
    throw new Error('Format lampiran PDF tidak valid.');
  }

  const obj = raw as Record<string, unknown>;
  const mimeType = String(obj.mimeType ?? '').toLowerCase();
  if (mimeType !== 'application/pdf') {
    throw new Error('File lampiran wajib berformat PDF (application/pdf).');
  }

  const rawBase64 = String(obj.dataBase64 ?? '').trim().replace(/\s+/g, '');
  if (!rawBase64 || !/^[A-Za-z0-9+/=]+$/.test(rawBase64)) {
    throw new Error('Isi file PDF tidak valid.');
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length < 5) {
    throw new Error('File PDF kosong atau rusak.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error('Ukuran file PDF maksimal 5 MB.');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('File yang diunggah bukan dokumen PDF yang valid.');
  }

  return {
    fileName: sanitizePdfFileName(obj.fileName),
    buffer,
    dataBase64: rawBase64,
  };
}

function validateReportInput(body: Record<string, unknown>, role: UserRole) {
  const reportDate = String(body.reportDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Tanggal kegiatan harus berformat YYYY-MM-DD.');
  }

  const startTime = String(body.startTime ?? '').trim();
  const endTime = String(body.endTime ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error('Jam mulai dan jam selesai wajib diisi (format HH:MM).');
  }
  if (endTime <= startTime) {
    throw new Error('Jam selesai harus lebih akhir daripada jam mulai.');
  }

  const category = String(body.category ?? '') as ReportCategory;
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error('Kategori kegiatan tidak valid.');
  }

  const activityName = String(body.activityName ?? '').trim();
  if (activityName.length < 3 || activityName.length > 180) {
    throw new Error('Nama kegiatan wajib diisi (3 hingga 180 karakter).');
  }

  let sharingSessionTitle = '';
  if (category === 'Sharing Session') {
    sharingSessionTitle = String(body.sharingSessionTitle ?? '').trim();
    if (sharingSessionTitle.length < 3 || sharingSessionTitle.length > 180) {
      throw new Error('Judul Sharing Session wajib diisi saat kategori Sharing Session dipilih.');
    }
  }

  const description = String(body.description ?? '').trim();
  if (description.length < 5 || description.length > 3000) {
    throw new Error('Uraian kegiatan wajib diisi (minimal 5 karakter).');
  }

  const achievements = String(body.achievements ?? '').trim();
  if (achievements.length < 3 || achievements.length > 2000) {
    throw new Error('Capaian kegiatan wajib diisi (minimal 3 karakter).');
  }

  const issues = String(body.issues ?? '').trim();
  if (issues.length < 3 || issues.length > 2000) {
    throw new Error('Kolom kendala wajib diisi (tulis "Tidak ada kendala" jika tidak ada hambatan).');
  }

  const followUp = String(body.followUp ?? '').trim();
  if (followUp.length < 3 || followUp.length > 2000) {
    throw new Error('Kolom tindak lanjut wajib diisi (minimal 3 karakter).');
  }

  const attachment = parseValidatedPdfAttachment(body.attachment, category);
  const removeAttachment = Boolean(body.removeAttachment);

  let status: ReportStatus = 'Under Review';
  let reviewNote = '';
  if (role === 'admin') {
    if (body.status) {
      const requestedStatus = String(body.status) as ReportStatus;
      if (!ALLOWED_STATUSES.has(requestedStatus)) {
        throw new Error('Status laporan harus Under Review atau Reviewed.');
      }
      status = requestedStatus;
    }
    reviewNote = String(body.reviewNote ?? '').trim().slice(0, 1000);
  }

  return {
    reportDate,
    startTime,
    endTime,
    category,
    activityName,
    sharingSessionTitle,
    description,
    achievements,
    issues,
    followUp,
    attachment,
    removeAttachment,
    status,
    reviewNote,
  };
}

interface AppsScriptCacheEntry {
  expiresAt: number;
  data: unknown;
}

const appsScriptReadCache = new Map<string, AppsScriptCacheEntry>();
const appsScriptInFlight = new Map<string, Promise<{ ok: boolean; data?: unknown; error?: string }>>();

function clearAppsScriptCache(prefix?: string): void {
  if (!prefix) {
    appsScriptReadCache.clear();
    return;
  }
  const fullPrefix = `${appsScriptState.url}|${prefix}`;
  for (const key of appsScriptReadCache.keys()) {
    if (key.startsWith(fullPrefix)) {
      appsScriptReadCache.delete(key);
    }
  }
}

function invalidateAppsScriptCacheForAction(action: string): void {
  switch (action) {
    case 'bootstrapAdmin':
      clearAppsScriptCache('authStatus');
      clearAppsScriptCache('users');
      break;
    case 'createBranch':
    case 'updateBranch':
    case 'deleteBranch':
      clearAppsScriptCache('branches');
      clearAppsScriptCache('reports');
      clearAppsScriptCache('users');
      break;
    case 'createReport':
    case 'updateReport':
    case 'updateReportStatus':
    case 'deleteReport':
      clearAppsScriptCache('reports');
      break;
    case 'createUser':
    case 'deleteUser':
      clearAppsScriptCache('users');
      clearAppsScriptCache('authStatus');
      break;
    default:
      break;
  }
}

async function callAppsScriptAction(
  action: string,
  payload: Record<string, unknown> = {},
  appsScriptToken?: string
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!appsScriptState.url) {
    throw new Error('URL Google Apps Script belum dikonfigurasi.');
  }
  const sharedSecret = (process.env.APPS_SCRIPT_SHARED_SECRET ?? '').trim();
  const body = JSON.stringify({
    action,
    payload,
    token: appsScriptToken ?? '',
    sharedSecret: sharedSecret || undefined,
  });

  const result = (await fetchAppsScriptSafe(appsScriptState.url, {
    method: 'POST',
    body,
  })) as { ok?: boolean; data?: unknown; error?: string };

  const normalized = {
    ok: Boolean(result?.ok),
    data: result?.data,
    error: result?.error,
  };

  if (normalized.ok) {
    invalidateAppsScriptCacheForAction(action);
  }

  return normalized;
}

async function callAppsScriptCachedRead(
  cacheSegment: string,
  ttlMs: number,
  action: string,
  payload: Record<string, unknown>,
  appsScriptToken: string | undefined,
  forceRefresh: boolean
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const fullKey = `${appsScriptState.url}|${cacheSegment}`;
  if (!forceRefresh) {
    const cached = appsScriptReadCache.get(fullKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, data: cached.data };
    }
    const pending = appsScriptInFlight.get(fullKey);
    if (pending) {
      return pending;
    }
  }

  const reqPromise = callAppsScriptAction(action, payload, appsScriptToken)
    .then((res) => {
      if (res.ok) {
        appsScriptReadCache.set(fullKey, {
          expiresAt: Date.now() + ttlMs,
          data: res.data,
        });
      }
      return res;
    })
    .finally(() => {
      appsScriptInFlight.delete(fullKey);
    });

  if (!forceRefresh) {
    appsScriptInFlight.set(fullKey, reqPromise);
  }
  return reqPromise;
}

/* ==================== EXPRESS APP ==================== */

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '8mb' }));

  /* ---------- Auth Routes ---------- */

  app.get('/api/auth/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { token, viaCookie } = extractAuthCredentials(req);
    if (!token) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const resolved = resolveSessionUser(token);
    if (!resolved) {
      if (viaCookie) clearSessionCookie(req, res);
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: resolved.user });
  });

  app.get('/api/auth/status', async (req, res) => {
    try {
      if (appsScriptState.mode === 'appscript' && appsScriptState.url) {
        const forceRefresh = req.query.refresh === '1';
        const remote = await callAppsScriptCachedRead(
          'authStatus',
          60_000,
          'authStatus',
          {},
          undefined,
          forceRefresh
        );
        if (remote.ok && remote.data && typeof remote.data === 'object') {
          const data = remote.data as { needsSetup?: boolean };
          res.json({
            needsSetup: Boolean(data.needsSetup),
            hasEnvAdmin: false,
            backendMode: 'appscript',
            appsScriptConfigured: true,
            adminEmailDomain: ADMIN_EMAIL_DOMAIN,
          });
          return;
        }
      }

      res.json({
        needsSetup: !hasAnyAdmin(),
        hasEnvAdmin: Boolean(envAdminPassword),
        backendMode: appsScriptState.mode,
        appsScriptConfigured: Boolean(appsScriptState.url),
        adminEmailDomain: ADMIN_EMAIL_DOMAIN,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menghubungi backend Apps Script.',
      });
    }
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const fullName = String(req.body?.fullName ?? '').trim();
      const password = String(req.body?.password ?? '');

      if (!isValidWmAdminEmail(email)) {
        res.status(400).json({
          error: `Email Admin wajib menggunakan domain ${ADMIN_EMAIL_DOMAIN} (contoh: admin@wmcenter.id).`,
        });
        return;
      }
      if (fullName.length < 2 || fullName.length > 80) {
        res.status(400).json({ error: 'Nama lengkap wajib diisi (maks. 80 karakter).' });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'Password minimal 8 karakter.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && appsScriptState.url) {
        const remote = await callAppsScriptAction('bootstrapAdmin', {
          email,
          fullName,
          password,
        });
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Aktivasi Admin gagal.' });
          return;
        }
        const data = remote.data as { token: string; user: UserProfile };
        const localToken = createLocalSession(data.user.id, {
          appsScriptToken: data.token,
          userSnapshot: data.user,
        });
        setSessionCookie(req, res, localToken);
        res.status(201).json({ token: localToken, user: data.user });
        return;
      }

      if (envAdminPassword || hasAnyAdmin()) {
        res.status(409).json({ error: 'Akun Admin sudah diaktifkan sebelumnya.' });
        return;
      }

      const { salt, hash } = hashSecret(password);
      const adminUser: StoredUser = {
        id: 'usr-' + crypto.randomBytes(6).toString('hex'),
        identifier: email,
        fullName,
        role: 'admin',
        branchId: null,
        secretSalt: salt,
        secretHash: hash,
        createdAt: new Date().toISOString(),
      };
      users.push(adminUser);

      const token = createLocalSession(adminUser.id);
      setSessionCookie(req, res, token);
      res.status(201).json({ token, user: toUserProfile(adminUser) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengaktifkan akun Admin.',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const loginType: UserRole = req.body?.loginType === 'admin' ? 'admin' : 'leader';
      const rawIdentifier = req.body?.identifier;
      const identifier =
        loginType === 'admin' ? normalizeEmail(rawIdentifier) : normalizeUsername(rawIdentifier);
      const rawSecret = String(req.body?.secret ?? '');
      const secret = loginType === 'leader' ? rawSecret.trim() : rawSecret;

      if (!identifier || !secret) {
        res.status(400).json({
          error:
            loginType === 'admin'
              ? 'Email WM Center dan password wajib diisi.'
              : 'Username dan kode akses leader wajib diisi.',
        });
        return;
      }

      if (loginType === 'admin' && !isValidWmAdminEmail(identifier)) {
        res.status(400).json({
          error: `Login Admin wajib menggunakan email ${ADMIN_EMAIL_DOMAIN}.`,
        });
        return;
      }

      if (appsScriptState.mode === 'appscript' && appsScriptState.url) {
        const remote = await callAppsScriptAction('login', {
          loginType,
          identifier,
          secret,
        });
        if (!remote.ok) {
          res.status(401).json({ error: remote.error || 'Kredensial tidak sesuai.' });
          return;
        }
        const data = remote.data as { token: string; user: UserProfile };
        const localToken = createLocalSession(data.user.id, {
          appsScriptToken: data.token,
          userSnapshot: data.user,
        });
        setSessionCookie(req, res, localToken);
        res.json({ token: localToken, user: data.user });
        return;
      }

      const found = users.find((u) => u.role === loginType && u.identifier === identifier);
      if (!found || !verifySecret(secret, found.secretSalt, found.secretHash)) {
        res.status(401).json({
          error:
            loginType === 'admin'
              ? 'Email WM Center atau password tidak sesuai.'
              : 'Username atau kode akses leader tidak sesuai.',
        });
        return;
      }

      const token = createLocalSession(found.id);
      setSessionCookie(req, res, token);
      res.json({ token, user: toUserProfile(found) });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memproses login.',
      });
    }
  });

  app.post('/api/auth/logout', async (req: AuthedRequest, res) => {
    const { token, viaCookie } = extractAuthCredentials(req);
    if (viaCookie && !isSafeCookieMutation(req)) {
      res.status(403).json({ error: 'Permintaan logout ditolak.' });
      return;
    }
    if (token) {
      const session = sessions.get(token);
      if (appsScriptState.mode === 'appscript' && session?.appsScriptToken) {
        try {
          await callAppsScriptAction('logout', {}, session.appsScriptToken);
        } catch {
          // tetap hapus sesi lokal
        }
      }
      sessions.delete(token);
      savePersistedSessions();
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: req.currentUser });
  });

  /* ---------- Branches Routes (Admin CRUD, Leader Read-Own) ---------- */

  app.get('/api/branches', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.currentUser!;
      const forceRefresh = req.query.refresh === '1';
      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const scopeKey = user.role === 'admin' ? 'admin' : `leader:${user.branchId ?? 'none'}`;
        const remote = await callAppsScriptCachedRead(
          `branches|${scopeKey}`,
          45_000,
          'listBranches',
          {},
          req.session.appsScriptToken,
          forceRefresh
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memuat daftar cabang.' });
          return;
        }
        res.json({ branches: remote.data });
        return;
      }

      if (user.role === 'leader') {
        res.json({ branches: branches.filter((b) => b.id === user.branchId) });
        return;
      }

      res.json({ branches });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memuat data cabang.',
      });
    }
  });

  app.post('/api/branches', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const code = String(req.body?.code ?? '').trim().toUpperCase();
      const name = String(req.body?.name ?? '').trim();
      const city = String(req.body?.city ?? '').trim();
      const address = String(req.body?.address ?? '').trim().slice(0, 240);

      if (!/^[A-Z0-9-]{2,14}$/.test(code)) {
        res.status(400).json({
          error: 'Kode cabang harus 2–14 karakter (huruf kapital, angka, tanda hubung).',
        });
        return;
      }
      if (name.length < 3 || name.length > 80) {
        res.status(400).json({ error: 'Nama cabang harus 3–80 karakter.' });
        return;
      }
      if (city.length < 2 || city.length > 60) {
        res.status(400).json({ error: 'Nama kota wajib diisi.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'createBranch',
          { code, name, city, address },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal menambah cabang.' });
          return;
        }
        res.status(201).json({ branch: remote.data });
        return;
      }

      if (branches.some((b) => b.code.toUpperCase() === code)) {
        res.status(409).json({ error: 'Kode cabang sudah digunakan.' });
        return;
      }

      const newBranch: Branch = {
        id: 'wm-' + crypto.randomBytes(4).toString('hex'),
        code,
        name,
        city,
        address,
      };
      branches.push(newBranch);
      res.status(201).json({ branch: newBranch });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menyimpan cabang baru.',
      });
    }
  });

  app.put('/api/branches/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const branchId = String(req.params.id ?? '');
      const code = String(req.body?.code ?? '').trim().toUpperCase();
      const name = String(req.body?.name ?? '').trim();
      const city = String(req.body?.city ?? '').trim();
      const address = String(req.body?.address ?? '').trim().slice(0, 240);

      if (!/^[A-Z0-9-]{2,14}$/.test(code)) {
        res.status(400).json({
          error: 'Kode cabang harus 2–14 karakter (huruf kapital, angka, tanda hubung).',
        });
        return;
      }
      if (name.length < 3 || name.length > 80) {
        res.status(400).json({ error: 'Nama cabang harus 3–80 karakter.' });
        return;
      }
      if (city.length < 2 || city.length > 60) {
        res.status(400).json({ error: 'Nama kota wajib diisi.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'updateBranch',
          { id: branchId, code, name, city, address },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memperbarui cabang.' });
          return;
        }
        res.json({ branch: remote.data });
        return;
      }

      const idx = branches.findIndex((b) => b.id === branchId);
      if (idx === -1) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }
      if (branches.some((b) => b.id !== branchId && b.code.toUpperCase() === code)) {
        res.status(409).json({ error: 'Kode cabang sudah digunakan cabang lain.' });
        return;
      }

      const updated: Branch = { id: branchId, code, name, city, address };
      branches[idx] = updated;

      // Sinkronkan nama & kode cabang pada laporan lokal
      for (const r of reports) {
        if (r.branchId === branchId) {
          r.branchName = updated.name;
          r.branchCode = updated.code;
        }
      }

      res.json({ branch: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memperbarui cabang.',
      });
    }
  });

  app.delete('/api/branches/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const branchId = String(req.params.id ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'deleteBranch',
          { id: branchId },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal menghapus cabang.' });
          return;
        }
        res.json({ ok: true, deletedId: branchId });
        return;
      }

      if (users.some((u) => u.branchId === branchId)) {
        res.status(409).json({
          error: 'Cabang masih memiliki akun Leader terdaftar. Hapus akun Leader tersebut terlebih dahulu.',
        });
        return;
      }

      const idx = branches.findIndex((b) => b.id === branchId);
      if (idx === -1) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }
      branches.splice(idx, 1);
      res.json({ ok: true, deletedId: branchId });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menghapus cabang.',
      });
    }
  });

  /* ---------- Reports Routes (CRUD & Branch Isolation) ---------- */

  app.get('/api/reports', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.currentUser!;
      const requestedBranch = typeof req.query.branchId === 'string' ? req.query.branchId : 'all';
      const forceRefresh = req.query.refresh === '1';

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const effectiveBranch = user.role === 'leader' ? user.branchId : requestedBranch;
        const scopeKey =
          user.role === 'admin'
            ? `admin:${effectiveBranch || 'all'}`
            : `leader:${user.branchId ?? 'none'}`;
        const remote = await callAppsScriptCachedRead(
          `reports|${scopeKey}`,
          30_000,
          'listReports',
          { branchId: effectiveBranch },
          req.session.appsScriptToken,
          forceRefresh
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memuat laporan.' });
          return;
        }
        res.json({ reports: remote.data });
        return;
      }

      const scoped = reports.filter((r) => {
        if (user.role === 'leader') {
          return r.branchId === user.branchId;
        }
        if (requestedBranch && requestedBranch !== 'all') {
          return r.branchId === requestedBranch;
        }
        return true;
      });

      const sorted = [...scoped].sort((a, b) =>
        `${b.reportDate}${b.startTime}${b.createdAt}`.localeCompare(
          `${a.reportDate}${a.startTime}${a.createdAt}`
        )
      );
      res.json({ reports: sorted });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal mengambil riwayat laporan.',
      });
    }
  });

  app.post('/api/reports', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.currentUser!;
      const validated = validateReportInput(req.body ?? {}, user.role);

      // ATURAN KETAT: Leader otomatis terkunci ke cabang penempatannya
      const targetBranchId =
        user.role === 'leader' ? user.branchId ?? '' : String(req.body?.branchId ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remotePayload: Record<string, unknown> = {
          reportDate: validated.reportDate,
          startTime: validated.startTime,
          endTime: validated.endTime,
          branchId: targetBranchId,
          category: validated.category,
          activityName: validated.activityName,
          sharingSessionTitle: validated.sharingSessionTitle,
          description: validated.description,
          achievements: validated.achievements,
          issues: validated.issues,
          followUp: validated.followUp,
          status: validated.status,
          reviewNote: validated.reviewNote,
          ...(validated.attachment
            ? {
                attachment: {
                  fileName: validated.attachment.fileName,
                  mimeType: 'application/pdf',
                  dataBase64: validated.attachment.dataBase64,
                },
              }
            : {}),
        };
        const remote = await callAppsScriptAction(
          'createReport',
          remotePayload,
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal menyimpan laporan.' });
          return;
        }
        res.status(201).json({ report: remote.data });
        return;
      }

      const branch = branches.find((b) => b.id === targetBranchId);
      if (!branch) {
        res.status(400).json({ error: 'Cabang tujuan tidak valid.' });
        return;
      }

      const now = new Date().toISOString();
      const dateKey = validated.reportDate.replace(/-/g, '');
      const reportId = `WM-${dateKey}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      if (validated.attachment) {
        attachments.set(reportId, {
          fileName: validated.attachment.fileName,
          buffer: validated.attachment.buffer,
        });
      }

      const report: BranchReport = {
        id: reportId,
        reportDate: validated.reportDate,
        startTime: validated.startTime,
        endTime: validated.endTime,
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        category: validated.category,
        activityName: validated.activityName,
        sharingSessionTitle: validated.sharingSessionTitle,
        description: validated.description,
        achievements: validated.achievements,
        issues: validated.issues,
        followUp: validated.followUp,
        hasAttachment: Boolean(validated.attachment),
        attachmentName: validated.attachment ? validated.attachment.fileName : '',
        attachmentSize: validated.attachment ? validated.attachment.buffer.length : 0,
        status: validated.status,
        reviewNote: validated.reviewNote,
        createdById: user.id,
        createdByName: user.fullName,
        createdByRole: user.role,
        createdAt: now,
        updatedAt: now,
      };

      reports.unshift(report);
      res.status(201).json({ report });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Data laporan tidak valid.',
      });
    }
  });

  app.get('/api/reports/:id/attachment', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.currentUser!;
      const reportId = String(req.params.id ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'getAttachment',
          { id: reportId },
          req.session.appsScriptToken
        );
        if (!remote.ok || !remote.data || typeof remote.data !== 'object') {
          res.status(404).json({ error: remote.error || 'Lampiran PDF tidak ditemukan.' });
          return;
        }
        const data = remote.data as { fileName?: string; dataBase64?: string };
        const buf = Buffer.from(String(data.dataBase64 ?? ''), 'base64');
        if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
          res.status(502).json({ error: 'Format lampiran PDF dari Google Drive tidak valid.' });
          return;
        }
        const safeName = sanitizePdfFileName(data.fileName || `lampiran-${reportId}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        res.send(buf);
        return;
      }

      const report = reports.find((r) => r.id === reportId);
      if (!report) {
        res.status(404).json({ error: 'Laporan tidak ditemukan.' });
        return;
      }
      if (user.role === 'leader' && report.branchId !== user.branchId) {
        res.status(403).json({ error: 'Anda tidak memiliki izin mengakses lampiran cabang lain.' });
        return;
      }

      const file = attachments.get(reportId);
      if (!file) {
        res.status(404).json({ error: 'Laporan ini tidak memiliki lampiran PDF.' });
        return;
      }

      const safeName = sanitizePdfFileName(file.fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.send(file.buffer);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal mengunduh lampiran PDF.',
      });
    }
  });

  app.put('/api/reports/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const reportId = String(req.params.id ?? '');
      const validated = validateReportInput(req.body ?? {}, 'admin');
      const targetBranchId = String(req.body?.branchId ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remotePayload: Record<string, unknown> = {
          id: reportId,
          reportDate: validated.reportDate,
          startTime: validated.startTime,
          endTime: validated.endTime,
          branchId: targetBranchId,
          category: validated.category,
          activityName: validated.activityName,
          sharingSessionTitle: validated.sharingSessionTitle,
          description: validated.description,
          achievements: validated.achievements,
          issues: validated.issues,
          followUp: validated.followUp,
          status: validated.status,
          reviewNote: validated.reviewNote,
          removeAttachment: validated.removeAttachment,
          ...(validated.attachment
            ? {
                attachment: {
                  fileName: validated.attachment.fileName,
                  mimeType: 'application/pdf',
                  dataBase64: validated.attachment.dataBase64,
                },
              }
            : {}),
        };
        const remote = await callAppsScriptAction(
          'updateReport',
          remotePayload,
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memperbarui laporan.' });
          return;
        }
        res.json({ report: remote.data });
        return;
      }

      const idx = reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        res.status(404).json({ error: 'Laporan tidak ditemukan.' });
        return;
      }

      const branch = branches.find((b) => b.id === targetBranchId);
      if (!branch) {
        res.status(400).json({ error: 'Cabang tujuan tidak valid.' });
        return;
      }

      let hasAttachment = reports[idx].hasAttachment;
      let attachmentName = reports[idx].attachmentName;
      let attachmentSize = reports[idx].attachmentSize;

      if (validated.category !== 'Sharing Session' || validated.removeAttachment) {
        attachments.delete(reportId);
        hasAttachment = false;
        attachmentName = '';
        attachmentSize = 0;
      }

      if (validated.attachment) {
        attachments.set(reportId, {
          fileName: validated.attachment.fileName,
          buffer: validated.attachment.buffer,
        });
        hasAttachment = true;
        attachmentName = validated.attachment.fileName;
        attachmentSize = validated.attachment.buffer.length;
      }

      const updated: BranchReport = {
        ...reports[idx],
        reportDate: validated.reportDate,
        startTime: validated.startTime,
        endTime: validated.endTime,
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        category: validated.category,
        activityName: validated.activityName,
        sharingSessionTitle: validated.sharingSessionTitle,
        description: validated.description,
        achievements: validated.achievements,
        issues: validated.issues,
        followUp: validated.followUp,
        hasAttachment,
        attachmentName,
        attachmentSize,
        status: validated.status,
        reviewNote: validated.reviewNote,
        updatedAt: new Date().toISOString(),
      };
      reports[idx] = updated;
      res.json({ report: updated });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal memperbarui laporan.',
      });
    }
  });

  app.patch(
    '/api/reports/:id/status',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      try {
        const reportId = String(req.params.id ?? '');
        const status = String(req.body?.status ?? '') as ReportStatus;
        const reviewNote = String(req.body?.reviewNote ?? '').trim().slice(0, 1000);

        if (!ALLOWED_STATUSES.has(status)) {
          res.status(400).json({ error: 'Status laporan harus Under Review atau Reviewed.' });
          return;
        }

        if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
          const remote = await callAppsScriptAction(
            'updateReportStatus',
            { id: reportId, status, reviewNote },
            req.session.appsScriptToken
          );
          if (!remote.ok) {
            res.status(400).json({ error: remote.error || 'Gagal memperbarui status.' });
            return;
          }
          res.json({ report: remote.data });
          return;
        }

        const idx = reports.findIndex((r) => r.id === reportId);
        if (idx === -1) {
          res.status(404).json({ error: 'Laporan tidak ditemukan.' });
          return;
        }

        const updated: BranchReport = {
          ...reports[idx],
          status,
          reviewNote,
          updatedAt: new Date().toISOString(),
        };
        reports[idx] = updated;
        res.json({ report: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal mengubah status laporan.',
        });
      }
    }
  );

  app.delete('/api/reports/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const reportId = String(req.params.id ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'deleteReport',
          { id: reportId },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal menghapus laporan.' });
          return;
        }
        res.json({ ok: true, deletedId: reportId });
        return;
      }

      const idx = reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        res.status(404).json({ error: 'Laporan tidak ditemukan.' });
        return;
      }
      reports.splice(idx, 1);
      attachments.delete(reportId);
      res.json({ ok: true, deletedId: reportId });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menghapus laporan.',
      });
    }
  });

  /* ---------- Users Management (Admin Only) ---------- */

  app.get('/api/users', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const forceRefresh = req.query.refresh === '1';
      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptCachedRead(
          'users|admin',
          45_000,
          'listUsers',
          {},
          req.session.appsScriptToken,
          forceRefresh
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memuat daftar pengguna.' });
          return;
        }
        res.json({ users: remote.data });
        return;
      }
      res.json({ users: users.map(toUserProfile) });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memuat daftar akun.',
      });
    }
  });

  app.post('/api/users', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'leader';
      const fullName = String(req.body?.fullName ?? '').trim();
      const rawSecret = String(req.body?.secret ?? '');
      const secret = role === 'leader' ? rawSecret.trim() : rawSecret;
      const identifier =
        role === 'admin'
          ? normalizeEmail(req.body?.identifier)
          : normalizeUsername(req.body?.identifier);
      const branchId = role === 'leader' ? String(req.body?.branchId ?? '') : null;

      if (role === 'admin') {
        if (!isValidWmAdminEmail(identifier)) {
          res.status(400).json({
            error: `Akun Admin wajib menggunakan email ${ADMIN_EMAIL_DOMAIN}.`,
          });
          return;
        }
        if (secret.length < 8 || secret.length > 128) {
          res.status(400).json({ error: 'Password Admin minimal 8 karakter.' });
          return;
        }
      } else {
        if (identifier.length < 3 || identifier.length > 40) {
          res.status(400).json({ error: 'Username Leader harus 3–40 karakter.' });
          return;
        }
        if (secret.length < 6 || secret.length > 64) {
          res.status(400).json({ error: 'Kode akses Leader minimal 6 karakter.' });
          return;
        }
      }

      if (fullName.length < 2 || fullName.length > 80) {
        res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'createUser',
          { identifier, fullName, role, branchId, secret },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal membuat akun baru.' });
          return;
        }
        res.status(201).json({ user: remote.data });
        return;
      }

      if (role === 'leader' && !branches.some((b) => b.id === branchId)) {
        res.status(400).json({ error: 'Leader wajib ditempatkan pada cabang yang valid.' });
        return;
      }

      if (users.some((u) => u.identifier.toLowerCase() === identifier.toLowerCase())) {
        res.status(409).json({
          error:
            role === 'admin' ? 'Email Admin sudah terdaftar.' : 'Username Leader sudah terdaftar.',
        });
        return;
      }

      const { salt, hash } = hashSecret(secret);
      const created: StoredUser = {
        id: 'usr-' + crypto.randomBytes(6).toString('hex'),
        identifier,
        fullName,
        role,
        branchId,
        secretSalt: salt,
        secretHash: hash,
        createdAt: new Date().toISOString(),
      };
      users.push(created);
      res.status(201).json({ user: toUserProfile(created) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuat pengguna baru.',
      });
    }
  });

  app.delete('/api/users/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const targetId = String(req.params.id ?? '');
      if (targetId === req.currentUser!.id) {
        res.status(400).json({ error: 'Tidak dapat menghapus akun yang sedang Anda gunakan.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'deleteUser',
          { id: targetId },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal menghapus pengguna.' });
          return;
        }
        res.json({ ok: true, deletedId: targetId });
        return;
      }

      const idx = users.findIndex((u) => u.id === targetId);
      if (idx === -1) {
        res.status(404).json({ error: 'Akun tidak ditemukan.' });
        return;
      }
      users.splice(idx, 1);
      res.json({ ok: true, deletedId: targetId });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menghapus akun.',
      });
    }
  });

  /* ---------- Google Apps Script Integration Routes (Admin Only) ---------- */

  app.get('/api/appscript/code', requireAuth, requireAdmin, (_req, res) => {
    const codePath = path.resolve(__dirname, 'appscript', 'Code.gs');
    if (!fs.existsSync(codePath)) {
      res.status(404).json({ error: 'File Code.gs tidak ditemukan.' });
      return;
    }
    const content = fs.readFileSync(codePath, 'utf8');
    res.json({ filename: 'Code.gs', code: content });
  });

  app.get('/api/appscript/config', requireAuth, requireAdmin, (_req, res) => {
    res.json({
      mode: appsScriptState.mode,
      url: appsScriptState.url,
      fromEnv: appsScriptState.fromEnv,
      hasSharedSecret: Boolean((process.env.APPS_SCRIPT_SHARED_SECRET ?? '').trim()),
    });
  });

  app.post('/api/appscript/test', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawUrl = String(req.body?.url ?? appsScriptState.url ?? '').trim();
      const validated = validateAppsScriptUrl(rawUrl);
      const pingUrl = new URL(validated.toString());
      pingUrl.searchParams.set('action', 'ping');

      const result = (await fetchAppsScriptSafe(pingUrl.toString(), { method: 'GET' })) as {
        ok?: boolean;
        spreadsheetName?: string;
        initialized?: boolean;
        error?: string;
      };

      if (!result?.ok) {
        res.status(400).json({ error: result?.error || 'Ping ke Apps Script gagal.' });
        return;
      }

      res.json({
        ok: true,
        spreadsheetName: result.spreadsheetName || 'Google Spreadsheet',
        initialized: Boolean(result.initialized),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Koneksi ke Google Apps Script gagal.',
      });
    }
  });

  app.post('/api/appscript/config', requireAuth, requireAdmin, async (req, res) => {
    try {
      const nextMode = req.body?.mode === 'appscript' ? 'appscript' : 'local';
      const rawUrl = String(req.body?.url ?? '').trim();

      if (nextMode === 'appscript') {
        const validated = validateAppsScriptUrl(rawUrl);
        const sharedSecret = (process.env.APPS_SCRIPT_SHARED_SECRET ?? '').trim();

        const probe = (await fetchAppsScriptSafe(validated.toString(), {
          method: 'POST',
          body: JSON.stringify({
            action: 'authStatus',
            payload: {},
            token: '',
            sharedSecret: sharedSecret || undefined,
          }),
        })) as { ok?: boolean; error?: string };

        if (!probe?.ok) {
          res.status(400).json({
            error:
              probe?.error ||
              'Apps Script merespons error. Pastikan fungsi setupSpreadsheet() sudah dijalankan di editor Apps Script.',
          });
          return;
        }

        appsScriptState = {
          mode: 'appscript',
          url: validated.toString(),
          fromEnv: false,
        };
        savePersistedAppsScriptConfig('appscript', validated.toString());
        clearAppsScriptCache();
        sessions.clear();
        savePersistedSessions();
        clearSessionCookie(req, res);
      } else {
        if (rawUrl) {
          validateAppsScriptUrl(rawUrl);
        }
        appsScriptState = {
          mode: 'local',
          url: rawUrl,
          fromEnv: false,
        };
        savePersistedAppsScriptConfig('local', rawUrl);
        clearAppsScriptCache();
      }

      res.json({
        mode: appsScriptState.mode,
        url: appsScriptState.url,
        fromEnv: appsScriptState.fromEnv,
        hasSharedSecret: Boolean((process.env.APPS_SCRIPT_SHARED_SECRET ?? '').trim()),
        reloginRequired: nextMode === 'appscript',
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Konfigurasi Apps Script tidak valid.',
      });
    }
  });

  /* ---------- Vite Dev Middleware / Production Static ---------- */

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WM Center Reporting server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
