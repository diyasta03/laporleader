import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Info,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AuthBootstrapStatus, UserProfile } from '../types';

interface AuthScreenProps {
  status: AuthBootstrapStatus;
  notice?: string | null;
  onClearNotice?: () => void;
  onAuthenticated: (token: string, user: UserProfile) => void;
}

export function AuthScreen({
  status,
  notice,
  onClearNotice,
  onAuthenticated,
}: AuthScreenProps) {
  const [username, setUsername] = useState(status.needsSetup ? 'admin' : '');
  const [fullName, setFullName] = useState(status.needsSetup ? 'Administrator Pusat' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setPassword('');
    setConfirmPassword('');
    if (status.needsSetup) {
      setUsername((prev) => prev || 'admin');
      setFullName((prev) => prev || 'Administrator Pusat');
    } else {
      setUsername('');
    }
  }, [status.needsSetup]);

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onClearNotice?.();

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3) {
      setError('Username minimal 3 karakter.');
      return;
    }

    if (status.needsSetup) {
      if (fullName.trim().length < 2) {
        setError('Nama lengkap wajib diisi.');
        return;
      }
      if (!passwordLongEnough) {
        setError('Password minimal 8 karakter.');
        return;
      }
      if (!passwordsMatch) {
        setError('Konfirmasi password tidak cocok.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (status.needsSetup) {
        const res = await api.bootstrapAdmin({
          username: cleanUsername,
          fullName: fullName.trim(),
          password,
        });
        onAuthenticated(res.token, res.user);
      } else {
        const res = await api.login({
          username: cleanUsername,
          password,
        });
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Autentikasi gagal.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Header Ringkas Khusus Mobile agar Form Login Langsung Terlihat di Layar */}
      <header className="lg:hidden bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 className="w-5 h-5 text-teal-400 shrink-0" />
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
            LaporCabang
          </span>
        </div>
        <span className="text-xs text-slate-300 whitespace-nowrap shrink-0">
          {status.backendMode === 'appscript' ? 'Google Apps Script' : 'Server Lokal'}
        </span>
      </header>

      {/* Panel Kiri Khusus Desktop (lg+) */}
      <aside className="hidden lg:flex lg:w-[44%] xl:w-[42%] bg-slate-900 text-slate-100 px-12 py-14 xl:px-14 xl:py-16 flex-col justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-white">
            <Building2 className="w-6 h-6 text-teal-400 shrink-0" />
            <span className="font-display text-xl font-bold tracking-tight">LaporCabang</span>
          </div>

          <div className="mt-14 max-w-md">
            <p className="text-xs font-medium text-teal-300 tracking-wide">
              Pelaporan Kegiatan Antar Cabang
            </p>
            <h1 className="mt-3 text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
              Kendali laporan kegiatan cabang dalam satu sistem.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Pemisahan hak akses ketat antara Admin Pusat dan Leader Cabang, terintegrasi dengan
              Google Sheets melalui Google Apps Script.
            </p>
          </div>

          <dl className="mt-12 space-y-6 border-t border-slate-800 pt-8 max-w-md">
            <div>
              <dt className="text-sm font-semibold text-white">01. Admin Pusat</dt>
              <dd className="mt-1 text-sm text-slate-400 leading-relaxed">
                CRUD penuh laporan kegiatan seluruh cabang, kelola akun leader per cabang, serta
                pengaturan koneksi Google Apps Script.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-white">02. Leader Cabang</dt>
              <dd className="mt-1 text-sm text-slate-400 leading-relaxed">
                Menulis laporan kegiatan dan meninjau riwayat khusus untuk cabang tempat bertugas.
                Cabang lain otomatis terkunci di server.
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            Mode Backend:{' '}
            <strong className="text-slate-200 font-medium">
              {status.backendMode === 'appscript' ? 'Google Apps Script' : 'Server Lokal'}
            </strong>
          </span>
          <span>Autentikasi Berbasis Peran</span>
        </div>
      </aside>

      {/* Panel Kanan / Utama: Form Login & Aktivasi Admin */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 sm:p-8">
          <div className="flex items-center gap-2 text-teal-700">
            {status.needsSetup ? (
              <ShieldCheck className="w-4 h-4 shrink-0" />
            ) : (
              <Lock className="w-4 h-4 shrink-0" />
            )}
            <span className="text-xs font-semibold">
              {status.needsSetup ? 'Pengaturan Awal' : 'Masuk Sistem'}
            </span>
          </div>

          <h2 className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {status.needsSetup ? 'Aktivasi Akun Admin Utama' : 'Masuk ke LaporCabang'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            {status.needsSetup
              ? 'Buat akun Admin pertama untuk mulai mencatat laporan, menambah akun Leader tiap cabang, dan menghubungkan Google Apps Script.'
              : 'Masuk dengan username dan password akun Admin atau Leader cabang Anda.'}
          </p>

          {notice && !error && (
            <div
              role="status"
              className="mt-5 flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700"
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-teal-700" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {status.needsSetup && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-slate-700">
                  Nama Lengkap Admin
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                  className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                />
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                autoFocus={!status.needsSetup}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={status.needsSetup ? 'admin' : 'Contoh: admin atau leader.bandung'}
                className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="mt-1.5 relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={status.needsSetup ? 8 : 1}
                  autoComplete={status.needsSetup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={status.needsSetup ? 'Minimal 8 karakter' : 'Masukkan password'}
                  className="block w-full min-h-[44px] rounded-md border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:text-teal-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {status.needsSetup && (
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-slate-700"
                >
                  Konfirmasi Password
                </label>
                <div className="mt-1.5 relative">
                  <input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi password"
                    className="block w-full min-h-[44px] rounded-md border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((prev) => !prev)}
                    aria-label={showConfirm ? 'Sembunyikan konfirmasi password' : 'Lihat konfirmasi password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:text-teal-700"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Indikator syarat password yang bersih tanpa pill */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 ${
                      passwordLongEnough ? 'text-emerald-700 font-medium' : 'text-slate-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    Minimal 8 karakter
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      passwordsMatch ? 'text-emerald-700 font-medium' : 'text-slate-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    Konfirmasi cocok
                  </span>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <span>
                {submitting
                  ? 'Memproses...'
                  : status.needsSetup
                    ? 'Aktifkan & Masuk sebagai Admin'
                    : 'Masuk'}
              </span>
              {!submitting && <ArrowRight className="w-4 h-4 shrink-0" />}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
            {status.needsSetup ? (
              <span>
                Setelah masuk sebagai Admin, Anda dapat menambahkan akun Leader untuk tiap cabang di
                menu <strong className="font-medium text-slate-700">Akun & Cabang</strong>.
              </span>
            ) : (
              <span>
                Akses Leader otomatis dibatasi hanya pada cabang tempat bertugas. Hubungi Admin
                Pusat jika membutuhkan akun baru atau reset password.
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
