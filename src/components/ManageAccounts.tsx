import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { Branch, UserProfile, UserRole } from '../types';
import { formatDateTimeId } from '../lib/format';

interface ManageAccountsProps {
  currentUser: UserProfile;
  branches: Branch[];
  users: UserProfile[];
  onCreateUser: (payload: {
    username: string;
    fullName: string;
    role: UserRole;
    branchId: string | null;
    password: string;
  }) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onCreateBranch: (payload: {
    code: string;
    name: string;
    city: string;
    address: string;
  }) => Promise<void>;
}

export function ManageAccounts({
  currentUser,
  branches,
  users,
  onCreateUser,
  onDeleteUser,
  onCreateBranch,
}: ManageAccountsProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'branches'>('users');

  // Form User
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('leader');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userFeedback, setUserFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Form Branch
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bCity, setBCity] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchFeedback, setBranchFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  async function handleUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUserFeedback(null);
    setUserSubmitting(true);
    try {
      await onCreateUser({
        username: username.trim().toLowerCase(),
        fullName: fullName.trim(),
        role,
        branchId: role === 'leader' ? branchId || branches[0]?.id || null : null,
        password,
      });
      setUsername('');
      setFullName('');
      setPassword('');
      setShowPassword(false);
      setUserFeedback({
        type: 'ok',
        text: `Akun ${role === 'admin' ? 'Admin' : 'Leader'} berhasil dibuat.`,
      });
    } catch (err) {
      setUserFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal membuat akun.',
      });
    } finally {
      setUserSubmitting(false);
    }
  }

  async function handleBranchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBranchFeedback(null);
    setBranchSubmitting(true);
    try {
      await onCreateBranch({
        code: bCode.trim().toUpperCase(),
        name: bName.trim(),
        city: bCity.trim(),
        address: bAddress.trim(),
      });
      setBCode('');
      setBName('');
      setBCity('');
      setBAddress('');
      setBranchFeedback({ type: 'ok', text: 'Cabang baru berhasil ditambahkan.' });
    } catch (err) {
      setBranchFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menambahkan cabang.',
      });
    } finally {
      setBranchSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Segmented Tab Control — Full width di mobile, inline di desktop */}
      <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'users'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Akun ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('branches')}
          className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'branches'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Cabang ({branches.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Form Tambah Akun */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <div className="flex items-center gap-2 text-slate-900">
              <UserPlus className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-semibold">Tambah Akun Pengguna</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Setiap Leader wajib ditautkan ke satu cabang agar akses laporan terkunci sesuai lokasi
              kerjanya.
            </p>

            {userFeedback && (
              <div
                role="status"
                className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs ${
                  userFeedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {userFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{userFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleUserSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="acc-fullname" className="block text-xs font-medium text-slate-700">
                  Nama Lengkap
                </label>
                <input
                  id="acc-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Nadia Kusuma"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                />
              </div>

              <div>
                <label htmlFor="acc-username" className="block text-xs font-medium text-slate-700">
                  Username
                </label>
                <input
                  id="acc-username"
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Contoh: leader.bandung"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="acc-role" className="block text-xs font-medium text-slate-700">
                    Peran
                  </label>
                  <select
                    id="acc-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="leader">Leader Cabang</option>
                    <option value="admin">Admin Pusat</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="acc-branch" className="block text-xs font-medium text-slate-700">
                    Cabang Penempatan
                  </label>
                  {role === 'leader' ? (
                    <select
                      id="acc-branch"
                      required
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-1 min-h-[42px] flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      Semua Cabang
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="acc-password" className="block text-xs font-medium text-slate-700">
                  Password Awal
                </label>
                <div className="mt-1 relative">
                  <input
                    id="acc-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 8 karakter"
                    className="block w-full min-h-[42px] rounded-md border border-slate-300 pl-3 pr-11 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={userSubmitting}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 transition-colors"
              >
                {userSubmitting ? 'Menyimpan...' : 'Buat Akun'}
              </button>
            </form>
          </section>

          {/* Daftar Pengguna — List di mobile, Tabel di md+ */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Daftar Akun Terdaftar</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Keluar lalu masuk dengan akun Leader cabang untuk memverifikasi isolasi akses per
                cabang.
              </p>
            </div>

            <div className="md:hidden divide-y divide-slate-200">
              {users.map((u) => (
                <div key={u.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-slate-900 truncate">{u.fullName}</div>
                    <div className="text-xs font-mono text-slate-500 truncate">{u.username}</div>
                    <div className="mt-1.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">
                        {u.role === 'admin' ? 'Admin Pusat' : 'Leader'}
                      </span>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        {u.role === 'admin'
                          ? 'Semua Cabang'
                          : `${u.branchName ?? '-'} (${u.branchCode ?? '-'})`}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {u.id === currentUser.id ? (
                      <span className="text-xs text-slate-400">Aktif</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDeleteUser(u.id)}
                        title="Hapus akun"
                        className="p-2 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 pl-5 pr-3">Nama & Username</th>
                    <th className="py-3 px-3">Peran & Akses Cabang</th>
                    <th className="py-3 px-3 whitespace-nowrap">Dibuat</th>
                    <th className="py-3 pl-3 pr-5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3">
                        <div className="font-medium text-slate-900">{u.fullName}</div>
                        <div className="text-xs font-mono text-slate-500">{u.username}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">
                        <span className="font-medium text-slate-900">
                          {u.role === 'admin' ? 'Admin Pusat' : 'Leader Cabang'}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span>
                          {u.role === 'admin'
                            ? 'Semua Cabang'
                            : `${u.branchName ?? '-'} (${u.branchCode ?? '-'})`}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {formatDateTimeId(u.createdAt)}
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        {u.id === currentUser.id ? (
                          <span className="text-xs text-slate-400">Aktif</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDeleteUser(u.id)}
                            title="Hapus akun"
                            className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Form Tambah Cabang */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <div className="flex items-center gap-2 text-slate-900">
              <Building2 className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-semibold">Tambah Cabang Baru</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Cabang baru langsung tersedia di form laporan Admin dan penugasan akun Leader.
            </p>

            {branchFeedback && (
              <div
                role="status"
                className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs ${
                  branchFeedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {branchFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{branchFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleBranchSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="br-code" className="block text-xs font-medium text-slate-700">
                    Kode Cabang
                  </label>
                  <input
                    id="br-code"
                    type="text"
                    required
                    value={bCode}
                    onChange={(e) => setBCode(e.target.value)}
                    placeholder="Contoh: SMG-06"
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="br-city" className="block text-xs font-medium text-slate-700">
                    Kota
                  </label>
                  <input
                    id="br-city"
                    type="text"
                    required
                    value={bCity}
                    onChange={(e) => setBCity(e.target.value)}
                    placeholder="Contoh: Semarang"
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="br-name" className="block text-xs font-medium text-slate-700">
                  Nama Cabang
                </label>
                <input
                  id="br-name"
                  type="text"
                  required
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  placeholder="Contoh: Cabang Semarang"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="br-addr" className="block text-xs font-medium text-slate-700">
                  Alamat Lengkap
                </label>
                <input
                  id="br-addr"
                  type="text"
                  value={bAddress}
                  onChange={(e) => setBAddress(e.target.value)}
                  placeholder="Contoh: Jl. Pemuda No. 102, Semarang"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={branchSubmitting}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 transition-colors"
              >
                {branchSubmitting ? 'Menyimpan...' : 'Simpan Cabang'}
              </button>
            </form>
          </section>

          {/* Daftar Cabang — List di mobile, Tabel di md+ */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Jaringan Cabang Aktif</h2>
            </div>

            <div className="md:hidden divide-y divide-slate-200">
              {branches.map((b) => (
                <div key={b.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-slate-900">{b.name}</span>
                    <span className="font-mono text-xs text-slate-500">{b.code}</span>
                  </div>
                  <div className="text-xs text-slate-600">{b.city}</div>
                  {b.address && <div className="text-xs text-slate-500">{b.address}</div>}
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 pl-5 pr-3">Kode</th>
                    <th className="py-3 px-3">Nama Cabang</th>
                    <th className="py-3 px-3">Kota</th>
                    <th className="py-3 pl-3 pr-5">Alamat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {branches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {b.code}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900 whitespace-nowrap">
                        {b.name}
                      </td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{b.city}</td>
                      <td className="py-3 pl-3 pr-5 text-xs text-slate-500">{b.address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
