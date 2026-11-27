import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import {
  WM_ADMIN_DOMAIN,
  type AuthBootstrapStatus,
  type UserProfile,
  type UserRole,
} from '../types';

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
  const [loginRole, setLoginRole] = useState<UserRole>('leader');

  // Setup Admin fields
  const [setupEmail, setSetupEmail] = useState('admin@wmcenter.id');
  const [setupFullName, setSetupFullName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');

  const [showSecret, setShowSecret] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setSecret('');
    setShowSecret(false);
  }, [status.needsSetup, loginRole]);

  const emailDomainValid = setupEmail.trim().toLowerCase().endsWith(WM_ADMIN_DOMAIN);
  const nameValid = setupFullName.trim().length >= 2;
  const passwordLongEnough = setupPassword.length >= 8;
  const passwordsMatch = setupPassword.length > 0 && setupPassword === setupConfirm;
  const canSubmitSetup = emailDomainValid && nameValid && passwordLongEnough && passwordsMatch;

  const cleanLoginId = identifier.trim().toLowerCase();
  const cleanLoginSecret = loginRole === 'leader' ? secret.trim() : secret;
  const loginAdminDomainOk =
    loginRole !== 'admin' || !cleanLoginId || cleanLoginId.endsWith(WM_ADMIN_DOMAIN);
  const canSubmitLogin =
    cleanLoginId.length >= 3 &&
    cleanLoginSecret.length >= 1 &&
    (loginRole !== 'admin' || cleanLoginId.endsWith(WM_ADMIN_DOMAIN));

  function handleRoleSwitch(nextRole: UserRole) {
    if (nextRole === loginRole) return;
    setLoginRole(nextRole);
    setIdentifier('');
    setSecret('');
    setError(null);
    onClearNotice?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onClearNotice?.();

    if (status.needsSetup) {
      const cleanEmail = setupEmail.trim().toLowerCase();
      if (!emailDomainValid) {
        setError(`Email Admin wajib menggunakan domain ${WM_ADMIN_DOMAIN}.`);
        return;
      }
      if (!nameValid) {
        setError('Nama lengkap Admin wajib diisi.');
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

      setSubmitting(true);
      try {
        const res = await api.bootstrapAdmin({
          email: cleanEmail,
          fullName: setupFullName.trim(),
          password: setupPassword,
        });
        onAuthenticated(res.token, res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Aktivasi Admin gagal.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!cleanLoginId || !cleanLoginSecret) {
      setError(
        loginRole === 'admin'
          ? 'Email WM Center dan password wajib diisi.'
          : 'Username dan kode akses cabang wajib diisi.'
      );
      return;
    }
    if (loginRole === 'admin' && !cleanLoginId.endsWith(WM_ADMIN_DOMAIN)) {
      setError(`Email Admin wajib berakhiran ${WM_ADMIN_DOMAIN}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.login({
        loginType: loginRole,
        identifier: cleanLoginId,
        secret: cleanLoginSecret,
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk. Periksa kembali data Anda.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col lg:flex-row">
      {/* Mobile Header Ringkas */}
      <header className="lg:hidden bg-[#0A172E] text-white px-5 py-4 flex items-center justify-between gap-4">
        <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
          WM Center
        </span>
        <span className="text-xs text-white/70 whitespace-nowrap">Portal Laporan Cabang</span>
      </header>

      {/* Desktop Left Panel (#0A172E) */}
      <aside className="hidden lg:flex lg:w-[44%] xl:w-[42%] bg-[#0A172E] text-white px-12 py-14 xl:px-14 xl:py-16 flex-col justify-between">
        <div>
          <div className="font-display text-xl font-bold tracking-tight text-white">
            WM Center
          </div>

          <div className="mt-16 max-w-md">
            <p className="text-xs font-medium text-white/60">
             Sistem Pelaporan Cabang
            </p>
            <h1 className="mt-3 text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
              Laporan kegiatan harian antar cabang dalam satu portal.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/75">
              Catat kegiatan harian klinik, Sharing Session beserta lampiran PDF, capaian, kendala,
              dan tindak lanjut di seluruh cabang WM Center.
            </p>
          </div>

          <dl className="mt-14 space-y-6 border-t border-white/15 pt-8 max-w-md">
            <div>
              <dt className="text-sm font-semibold text-white">Leader Cabang</dt>
              <dd className="mt-1 text-sm text-white/65 leading-relaxed">
                Masuk dengan username dan kode akses cabang dari Admin untuk mengisi laporan harian
                dan melihat riwayat cabang Anda.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-white">Admin WM Center</dt>
              <dd className="mt-1 text-sm text-white/65 leading-relaxed">
                Masuk dengan email <span className="font-mono text-white/90">@wmcenter.id</span>{' '}
                untuk memantau dashboard seluruh cabang, melakukan review laporan, serta mengelola
                akun dan cabang.
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-12 pt-6 border-t border-white/15 text-xs text-white/55">
        </div>
      </aside>

      {/* Main Auth Column */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6 lg:px-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 sm:p-8">
          <p className="text-xs font-semibold text-[#033367]">
            {status.needsSetup ? 'Pengaturan Awal' : 'Masuk Portal'}
          </p>

          <h2 className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-[#0A172E]">
            {status.needsSetup ? 'Buat Akun Admin Pertama' : 'Selamat Datang di WM Center'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            {status.needsSetup
              ? 'Aktifkan akun Admin pusat terlebih dahulu agar dapat mengelola cabang dan membuat akun Leader.'
              : 'Pilih peran Anda lalu masukkan data akun untuk melanjutkan.'}
          </p>

          {/* Pemilih Peran yang Jelas & Mudah Dipahami */}
          {!status.needsSetup && (
            <div className="mt-5">
              <div
                role="tablist"
                aria-label="Pilih jenis akun"
                className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-md"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginRole === 'leader'}
                  onClick={() => handleRoleSwitch('leader')}
                  className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    loginRole === 'leader'
                      ? 'bg-[#033367] text-white'
                      : 'text-slate-600 hover:text-[#0A172E]'
                  }`}
                >
                  Leader Cabang
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginRole === 'admin'}
                  onClick={() => handleRoleSwitch('admin')}
                  className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    loginRole === 'admin'
                      ? 'bg-[#033367] text-white'
                      : 'text-slate-600 hover:text-[#0A172E]'
                  }`}
                >
                  Admin WM Center
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {loginRole === 'leader'
                  ? 'Masuk memakai username & kode akses cabang dari Admin.'
                  : `Masuk memakai email resmi ${WM_ADMIN_DOMAIN} & password.`}
              </p>
            </div>
          )}

          {notice && !error && (
            <div
              role="status"
              className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm text-slate-700"
            >
              {notice}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs sm:text-sm text-rose-800"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            {status.needsSetup ? (
              <>
                <div>
                  <label htmlFor="setup-name" className="block text-sm font-medium text-[#0A172E]">
                    Nama Lengkap Admin
                  </label>
                  <input
                    id="setup-name"
                    type="text"
                    required
                    autoFocus
                    value={setupFullName}
                    onChange={(e) => {
                      setSetupFullName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Contoh: Admin Operasional WM Center"
                    className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                  />
                </div>

                <div>
                  <label htmlFor="setup-email" className="block text-sm font-medium text-[#0A172E]">
                    Email WM Center
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={setupEmail}
                    onChange={(e) => {
                      setSetupEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="admin@wmcenter.id"
                    className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                  />
                </div>

                <div>
                  <label htmlFor="setup-pass" className="block text-sm font-medium text-[#0A172E]">
                    Password
                  </label>
                  <div className="mt-1.5 relative">
                    <input
                      id="setup-pass"
                      type={showSecret ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={setupPassword}
                      onChange={(e) => {
                        setSetupPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Minimal 8 karakter"
                      className="block w-full min-h-[44px] rounded-md border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((p) => !p)}
                      aria-label={showSecret ? 'Sembunyikan password' : 'Lihat password'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-[#0A172E]"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="setup-confirm"
                    className="block text-sm font-medium text-[#0A172E]"
                  >
                    Ulangi Password
                  </label>
                  <div className="mt-1.5 relative">
                    <input
                      id="setup-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={setupConfirm}
                      onChange={(e) => {
                        setSetupConfirm(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Ketik ulang password yang sama"
                      className="block w-full min-h-[44px] rounded-md border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((p) => !p)}
                      aria-label={showConfirm ? 'Sembunyikan konfirmasi' : 'Lihat konfirmasi'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-[#0A172E]"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span
                      className={emailDomainValid ? 'text-[#033367] font-medium' : 'text-slate-400'}
                    >
                      Email {WM_ADMIN_DOMAIN}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={
                        passwordLongEnough ? 'text-[#033367] font-medium' : 'text-slate-400'
                      }
                    >
                      Min. 8 karakter
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={passwordsMatch ? 'text-[#033367] font-medium' : 'text-slate-400'}
                    >
                      Password cocok
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="login-id" className="block text-sm font-medium text-[#0A172E]">
                    {loginRole === 'admin' ? 'Email WM Center' : 'Username Leader'}
                  </label>
                  <input
                    id="login-id"
                    type={loginRole === 'admin' ? 'email' : 'text'}
                    required
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder={
                      loginRole === 'admin' ? 'nama@wmcenter.id' : 'Contoh: leader.sunter'
                    }
                    className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                  />
                  {!loginAdminDomainOk && (
                    <p className="mt-1 text-xs text-amber-700">
                      Gunakan alamat email berakhiran {WM_ADMIN_DOMAIN}.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="login-secret"
                    className="block text-sm font-medium text-[#0A172E]"
                  >
                    {loginRole === 'admin' ? 'Password' : 'Kode Akses Cabang'}
                  </label>
                  <div className="mt-1.5 relative">
                    <input
                      id="login-secret"
                      type={showSecret ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={secret}
                      onChange={(e) => {
                        setSecret(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder={
                        loginRole === 'admin'
                          ? 'Masukkan password Admin'
                          : 'Contoh: WMC-XXXXXX'
                      }
                      className="block w-full min-h-[44px] rounded-md border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-[#0A172E] placeholder:text-slate-400 focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((p) => !p)}
                      aria-label={showSecret ? 'Sembunyikan' : 'Tampilkan'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-[#0A172E]"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting || (status.needsSetup ? !canSubmitSetup : !canSubmitLogin)}
              className="mt-2 w-full min-h-[44px] rounded-md bg-[#033367] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0A172E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#033367] focus-visible:ring-offset-2 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {submitting
                ? status.needsSetup
                  ? 'Mengaktifkan Akun...'
                  : 'Memeriksa Akun...'
                : status.needsSetup
                  ? 'Aktifkan & Masuk sebagai Admin'
                  : loginRole === 'admin'
                    ? 'Masuk sebagai Admin'
                    : 'Masuk sebagai Leader'}
            </button>
          </form>

          <p className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
            {status.needsSetup
              ? 'Setelah masuk, buka menu Akun & Cabang untuk membuat username dan kode akses bagi setiap Leader cabang.'
              : loginRole === 'leader'
                ? 'Belum punya username atau lupa kode akses? Hubungi Admin WM Center untuk dibuatkan akun baru.'
                : 'Sesi login akan tetap aktif meski halaman dimuat ulang hingga Anda menekan tombol Keluar.'}
          </p>
        </div>
      </main>
    </div>
  );
}
