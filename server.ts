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
  ReportShift,
  ReportStatus,
  UserProfile,
  UserRole,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam

const ALLOWED_CATEGORIES = new Set<ReportCategory>([
  'Operasional Harian',
  'Pelayanan & Lapangan',
  'Stok & Logistik',
  'SDM & Kehadiran',
  'Kendala & Insiden',
]);

const ALLOWED_SHIFTS = new Set<ReportShift>(['Pagi', 'Siang', 'Malam', 'Penuh']);

const ALLOWED_STATUSES = new Set<ReportStatus>([
  'Terkirim',
  'Ditinjau',
  'Selesai',
  'Perlu Revisi',
]);

interface StoredUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

interface SessionRecord {
  userId: string;
  appsScriptToken?: string;
  userSnapshot?: UserProfile;
  expiresAt: number;
}

/* ==================== PASSWORD HASHING (SCRYPT) ==================== */

function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeUsername(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

/* ==================== SSRF-SAFE APPS SCRIPT VALIDATION & PROXY ==================== */

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
        // Google Apps Script Web App redirects POST 302 to GET script.googleusercontent.com
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

/* ==================== INITIAL LOCAL STORE ==================== */

const branches: Branch[] = [
  {
    id: 'cab-jkt',
    code: 'JKT-01',
    name: 'Cabang Jakarta Pusat',
    city: 'Jakarta Pusat',
    address: 'Jl. Jend. Sudirman Kav. 21, Jakarta Pusat',
  },
  {
    id: 'cab-bdg',
    code: 'BDG-02',
    name: 'Cabang Bandung',
    city: 'Bandung',
    address: 'Jl. Asia Afrika No. 88, Bandung',
  },
  {
    id: 'cab-sby',
    code: 'SBY-03',
    name: 'Cabang Surabaya',
    city: 'Surabaya',
    address: 'Jl. Basuki Rahmat No. 45, Surabaya',
  },
  {
    id: 'cab-mdn',
    code: 'MDN-04',
    name: 'Cabang Medan',
    city: 'Medan',
    address: 'Jl. Gatot Subroto No. 112, Medan',
  },
  {
    id: 'cab-mks',
    code: 'MKS-05',
    name: 'Cabang Makassar',
    city: 'Makassar',
    address: 'Jl. A.P. Pettarani No. 34, Makassar',
  },
];

const users: StoredUser[] = [];
const sessions = new Map<string, SessionRecord>();

const reports: BranchReport[] = [
  {
    id: 'RPT-20261125-001',
    reportDate: '2026-11-25',
    branchId: 'cab-jkt',
    branchName: 'Cabang Jakarta Pusat',
    branchCode: 'JKT-01',
    title: 'Briefing Pagi, Pengecekan Area Layanan & Tutup Operasional',
    category: 'Operasional Harian',
    shift: 'Penuh',
    staffPresent: 14,
    summary:
      'Kegiatan pembukaan cabang berjalan tepat waktu pukul 08.00 WIB. Seluruh loket pelayanan beroperasi normal dengan antrean tertib hingga jam tutup.',
    issues: 'Printer antrean loket 2 sempat macet selama 15 menit, sudah diganti unit cadangan.',
    status: 'Selesai',
    createdById: 'seed-jkt',
    createdByName: 'Raka Pratama',
    createdByRole: 'leader',
    createdAt: '2026-11-25T10:45:00.000Z',
    updatedAt: '2026-11-25T11:20:00.000Z',
  },
  {
    id: 'RPT-20261125-002',
    reportDate: '2026-11-25',
    branchId: 'cab-bdg',
    branchName: 'Cabang Bandung',
    branchCode: 'BDG-02',
    title: 'Penerimaan Pengiriman Stok Gudang & Penataan Rak Display',
    category: 'Stok & Logistik',
    shift: 'Pagi',
    staffPresent: 11,
    summary:
      'Penerimaan 120 karton barang dari gudang pusat selesai pukul 09.30 WIB. Seluruh item prioritas sudah diverifikasi dan ditata di rak display.',
    issues: 'Terdapat 2 karton kemasan penyok saat bongkar muat; sudah dibuatkan berita acara klaim logistik.',
    status: 'Ditinjau',
    createdById: 'seed-bdg',
    createdByName: 'Nadia Kusuma',
    createdByRole: 'leader',
    createdAt: '2026-11-25T09:15:00.000Z',
    updatedAt: '2026-11-25T09:15:00.000Z',
  },
  {
    id: 'RPT-20261124-003',
    reportDate: '2026-11-24',
    branchId: 'cab-sby',
    branchName: 'Cabang Surabaya',
    branchCode: 'SBY-03',
    title: 'Kegiatan Kunjungan Klien & Evaluasi Standar Pelayanan',
    category: 'Pelayanan & Lapangan',
    shift: 'Siang',
    staffPresent: 13,
    summary:
      'Tim lapangan menyelesaikan 6 jadwal kunjungan pemeliharaan klien di area Surabaya Timur sesuai rute dan SLA yang ditetapkan.',
    issues: '',
    status: 'Selesai',
    createdById: 'seed-sby',
    createdByName: 'Dimas Saputra',
    createdByRole: 'leader',
    createdAt: '2026-11-24T13:10:00.000Z',
    updatedAt: '2026-11-24T15:05:00.000Z',
  },
  {
    id: 'RPT-20261124-004',
    reportDate: '2026-11-24',
    branchId: 'cab-mdn',
    branchName: 'Cabang Medan',
    branchCode: 'MDN-04',
    title: 'Penanganan Gangguan Jaringan Internet & Pengalihan Sistem',
    category: 'Kendala & Insiden',
    shift: 'Siang',
    staffPresent: 9,
    summary:
      'Jaringan fiber utama mengalami gangguan selama 40 menit pukul 13.10–13.50 WIB. Aktivitas operasional sementara dialihkan ke modem cadangan 4G agar layanan tetap berjalan.',
    issues: 'Perlu eskalasi ke ISP agar stabilitas link utama cabang Medan dicek ulang minggu ini.',
    status: 'Perlu Revisi',
    createdById: 'seed-mdn',
    createdByName: 'Siti Rahmawati',
    createdByRole: 'leader',
    createdAt: '2026-11-24T11:30:00.000Z',
    updatedAt: '2026-11-24T14:00:00.000Z',
  },
  {
    id: 'RPT-20261123-005',
    reportDate: '2026-11-23',
    branchId: 'cab-mks',
    branchName: 'Cabang Makassar',
    branchCode: 'MKS-05',
    title: 'Pelatihan Singkat SOP Layanan & Penjadwalan Shift Akhir Pekan',
    category: 'SDM & Kehadiran',
    shift: 'Pagi',
    staffPresent: 10,
    summary:
      'Kehadiran staf 100% sesuai jadwal. Pelatihan penyegaran SOP pelayanan pelanggan dilaksanakan selama 30 menit sebelum jam operasional dibuka.',
    issues: 'Satu staf mengajukan cuti pada tanggal 29 November; pengganti shift sudah disiapkan.',
    status: 'Terkirim',
    createdById: 'seed-mks',
    createdByName: 'Fajar Hidayat',
    createdByRole: 'leader',
    createdAt: '2026-11-23T12:00:00.000Z',
    updatedAt: '2026-11-23T12:00:00.000Z',
  },
];

/* ==================== APPS SCRIPT RUNTIME CONFIG ==================== */

const envAppsScriptUrl = (process.env.APPS_SCRIPT_URL ?? '').trim();
let appsScriptState: {
  mode: 'local' | 'appscript';
  url: string;
  fromEnv: boolean;
} = {
  mode: envAppsScriptUrl ? 'appscript' : 'local',
  url: envAppsScriptUrl,
  fromEnv: Boolean(envAppsScriptUrl),
};

if (envAppsScriptUrl) {
  try {
    validateAppsScriptUrl(envAppsScriptUrl);
  } catch {
    appsScriptState = { mode: 'local', url: '', fromEnv: false };
  }
}

/* ==================== ENV ADMIN BOOTSTRAP CHECK ==================== */

const envAdminPassword = (process.env.ADMIN_INITIAL_PASSWORD ?? '').trim();
const envAdminUsername = normalizeUsername(process.env.ADMIN_INITIAL_USERNAME || 'admin') || 'admin';

function ensureEnvAdminUser(): void {
  if (!envAdminPassword) return;
  const existing = users.find((u) => u.id === 'usr-env-admin');
  const { salt, hash } = hashPassword(envAdminPassword);
  if (existing) {
    existing.username = envAdminUsername;
    existing.passwordSalt = salt;
    existing.passwordHash = hash;
    return;
  }
  users.unshift({
    id: 'usr-env-admin',
    username: envAdminUsername,
    fullName: 'Administrator Pusat',
    role: 'admin',
    branchId: null,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  });
}

ensureEnvAdminUser();

function toUserProfile(u: StoredUser): UserProfile {
  const branch = u.branchId ? branches.find((b) => b.id === u.branchId) ?? null : null;
  return {
    id: u.id,
    username: u.username,
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

function createLocalSession(userId: string, extra?: Partial<SessionRecord>): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    ...extra,
  });
  return token;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

interface AuthedRequest extends Request {
  authToken?: string;
  session?: SessionRecord;
  currentUser?: UserProfile;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan masuk terlebih dahulu.' });
    return;
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    res.status(401).json({ error: 'Sesi telah berakhir. Silakan masuk kembali.' });
    return;
  }

  if (appsScriptState.mode === 'appscript' && session.userSnapshot) {
    req.authToken = token;
    req.session = session;
    req.currentUser = session.userSnapshot;
    next();
    return;
  }

  const user = users.find((u) => u.id === session.userId);
  if (!user) {
    sessions.delete(token);
    res.status(401).json({ error: 'Akun tidak ditemukan.' });
    return;
  }

  req.authToken = token;
  req.session = session;
  req.currentUser = toUserProfile(user);
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Akses ditolak. Fitur ini khusus untuk Admin.' });
    return;
  }
  next();
}

function validateReportInput(body: Record<string, unknown>, role: UserRole) {
  const reportDate = String(body.reportDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Tanggal laporan harus berformat YYYY-MM-DD.');
  }

  const title = String(body.title ?? '').trim();
  if (title.length < 3 || title.length > 160) {
    throw new Error('Judul laporan harus antara 3 hingga 160 karakter.');
  }

  const category = String(body.category ?? '') as ReportCategory;
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error('Kategori laporan tidak valid.');
  }

  const summary = String(body.summary ?? '').trim();
  if (summary.length < 5 || summary.length > 3000) {
    throw new Error('Ringkasan laporan minimal 5 karakter (maks. 3000 karakter).');
  }

  const issues = String(body.issues ?? '').trim().slice(0, 2000);

  const shift = String(body.shift ?? 'Penuh') as ReportShift;
  if (!ALLOWED_SHIFTS.has(shift)) {
    throw new Error('Shift kegiatan tidak valid.');
  }

  const staffPresent = Number(body.staffPresent);
  if (!Number.isInteger(staffPresent) || staffPresent < 0 || staffPresent > 10000) {
    throw new Error('Jumlah staf hadir harus berupa bilangan bulat non-negatif.');
  }

  let status: ReportStatus = 'Terkirim';
  if (role === 'admin' && body.status) {
    const requestedStatus = String(body.status) as ReportStatus;
    if (!ALLOWED_STATUSES.has(requestedStatus)) {
      throw new Error('Status laporan tidak valid.');
    }
    status = requestedStatus;
  }

  return {
    reportDate,
    title,
    category,
    shift,
    staffPresent,
    summary,
    issues,
    status,
  };
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

  return {
    ok: Boolean(result?.ok),
    data: result?.data,
    error: result?.error,
  };
}

/* ==================== EXPRESS APP ==================== */

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  /* ---------- Auth Routes ---------- */

  app.get('/api/auth/status', async (_req, res) => {
    try {
      if (appsScriptState.mode === 'appscript' && appsScriptState.url) {
        const remote = await callAppsScriptAction('authStatus');
        if (remote.ok && remote.data && typeof remote.data === 'object') {
          const data = remote.data as { needsSetup?: boolean };
          res.json({
            needsSetup: Boolean(data.needsSetup),
            hasEnvAdmin: false,
            backendMode: 'appscript',
            appsScriptConfigured: true,
          });
          return;
        }
      }

      res.json({
        needsSetup: !hasAnyAdmin(),
        hasEnvAdmin: Boolean(envAdminPassword),
        backendMode: appsScriptState.mode,
        appsScriptConfigured: Boolean(appsScriptState.url),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menghubungi backend Apps Script.',
      });
    }
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const fullName = String(req.body?.fullName ?? '').trim();
      const password = String(req.body?.password ?? '');

      if (username.length < 3 || username.length > 40) {
        res.status(400).json({ error: 'Username harus 3–40 karakter (huruf, angka, titik, strip).' });
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
          username,
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
        res.status(201).json({ token: localToken, user: data.user });
        return;
      }

      if (envAdminPassword || hasAnyAdmin()) {
        res.status(409).json({ error: 'Akun Admin sudah diaktifkan sebelumnya.' });
        return;
      }

      const { salt, hash } = hashPassword(password);
      const adminUser: StoredUser = {
        id: 'usr-' + crypto.randomBytes(6).toString('hex'),
        username,
        fullName,
        role: 'admin',
        branchId: null,
        passwordSalt: salt,
        passwordHash: hash,
        createdAt: new Date().toISOString(),
      };
      users.push(adminUser);

      const token = createLocalSession(adminUser.id);
      res.status(201).json({ token, user: toUserProfile(adminUser) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengaktifkan akun Admin.',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password ?? '');

      if (!username || !password) {
        res.status(400).json({ error: 'Username dan password wajib diisi.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && appsScriptState.url) {
        const remote = await callAppsScriptAction('login', { username, password });
        if (!remote.ok) {
          res.status(401).json({ error: remote.error || 'Username atau password salah.' });
          return;
        }
        const data = remote.data as { token: string; user: UserProfile };
        const localToken = createLocalSession(data.user.id, {
          appsScriptToken: data.token,
          userSnapshot: data.user,
        });
        res.json({ token: localToken, user: data.user });
        return;
      }

      const found = users.find((u) => u.username === username);
      if (!found || !verifyPassword(password, found.passwordSalt, found.passwordHash)) {
        res.status(401).json({ error: 'Username atau password tidak sesuai.' });
        return;
      }

      const token = createLocalSession(found.id);
      res.json({ token, user: toUserProfile(found) });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memproses login.',
      });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
    if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
      try {
        await callAppsScriptAction('logout', {}, req.session.appsScriptToken);
      } catch {
        // tetap hapus sesi lokal
      }
    }
    if (req.authToken) {
      sessions.delete(req.authToken);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.currentUser });
  });

  /* ---------- Branches Routes ---------- */

  app.get('/api/branches', requireAuth, async (req: AuthedRequest, res) => {
    try {
      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction('listBranches', {}, req.session.appsScriptToken);
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memuat daftar cabang.' });
          return;
        }
        res.json({ branches: remote.data });
        return;
      }

      const user = req.currentUser!;
      if (user.role === 'leader') {
        const own = branches.filter((b) => b.id === user.branchId);
        res.json({ branches: own });
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

      if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
        res.status(400).json({ error: 'Kode cabang harus 2–12 karakter (huruf kapital, angka, tanda hubung).' });
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
        id: 'cab-' + crypto.randomBytes(4).toString('hex'),
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

  /* ---------- Reports Routes (CRUD & Branch Isolation) ---------- */

  app.get('/api/reports', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.currentUser!;
      const requestedBranch = typeof req.query.branchId === 'string' ? req.query.branchId : 'all';

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'listReports',
          { branchId: user.role === 'leader' ? user.branchId : requestedBranch },
          req.session.appsScriptToken
        );
        if (!remote.ok) {
          res.status(400).json({ error: remote.error || 'Gagal memuat laporan.' });
          return;
        }
        res.json({ reports: remote.data });
        return;
      }

      // ATURAN KETAT: Leader hanya menerima laporan milik cabangnya sendiri
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
        `${b.reportDate}${b.createdAt}`.localeCompare(`${a.reportDate}${a.createdAt}`)
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

      // ATURAN KETAT: Leader selalu dikunci ke branchId miliknya sendiri
      const targetBranchId =
        user.role === 'leader' ? user.branchId ?? '' : String(req.body?.branchId ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'createReport',
          { ...validated, branchId: targetBranchId },
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
      const report: BranchReport = {
        id: `RPT-${dateKey}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        reportDate: validated.reportDate,
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        title: validated.title,
        category: validated.category,
        shift: validated.shift,
        staffPresent: validated.staffPresent,
        summary: validated.summary,
        issues: validated.issues,
        status: validated.status,
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

  app.put('/api/reports/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const reportId = String(req.params.id ?? '');
      const validated = validateReportInput(req.body ?? {}, 'admin');
      const targetBranchId = String(req.body?.branchId ?? '');

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'updateReport',
          { id: reportId, ...validated, branchId: targetBranchId },
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

      const updated: BranchReport = {
        ...reports[idx],
        reportDate: validated.reportDate,
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        title: validated.title,
        category: validated.category,
        shift: validated.shift,
        staffPresent: validated.staffPresent,
        summary: validated.summary,
        issues: validated.issues,
        status: validated.status,
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
      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction('listUsers', {}, req.session.appsScriptToken);
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
      const username = normalizeUsername(req.body?.username);
      const fullName = String(req.body?.fullName ?? '').trim();
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'leader';
      const branchId = role === 'leader' ? String(req.body?.branchId ?? '') : null;
      const password = String(req.body?.password ?? '');

      if (username.length < 3 || username.length > 40) {
        res.status(400).json({ error: 'Username harus 3–40 karakter.' });
        return;
      }
      if (fullName.length < 2 || fullName.length > 80) {
        res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'Password minimal 8 karakter.' });
        return;
      }

      if (appsScriptState.mode === 'appscript' && req.session?.appsScriptToken) {
        const remote = await callAppsScriptAction(
          'createUser',
          { username, fullName, role, branchId, password },
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

      if (users.some((u) => u.username === username)) {
        res.status(409).json({ error: 'Username sudah terdaftar.' });
        return;
      }

      const { salt, hash } = hashPassword(password);
      const created: StoredUser = {
        id: 'usr-' + crypto.randomBytes(6).toString('hex'),
        username,
        fullName,
        role,
        branchId,
        passwordSalt: salt,
        passwordHash: hash,
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

        // Verifikasi doPost & struktur sheet sebelum mengaktifkan mode Apps Script agar Admin tidak terkunci keluar
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
        // Bersihkan sesi lama agar login berikutnya memakai token sesi Apps Script
        sessions.clear();
      } else {
        if (rawUrl) {
          validateAppsScriptUrl(rawUrl);
        }
        appsScriptState = {
          mode: 'local',
          url: rawUrl,
          fromEnv: false,
        };
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
    console.log(`LaporCabang server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
