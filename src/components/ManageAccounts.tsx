import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { WM_ADMIN_DOMAIN, type Branch, type UserProfile, type UserRole } from '../types';
import { formatDateTimeId } from '../lib/format';

interface ManageAccountsProps {
  currentUser: UserProfile;
  branches: Branch[];
  users: UserProfile[];
  onCreateUser: (payload: {
    identifier: string;
    fullName: string;
    role: UserRole;
    branchId: string | null;
    secret: string;
  }) => Promise<UserProfile | undefined>;
  onDeleteUser: (id: string) => Promise<void>;
  onCreateBranch: (payload: {
    code: string;
    name: string;
    city: string;
    address: string;
  }) => Promise<void>;
  onUpdateBranch: (
    id: string,
    payload: {
      code: string;
      name: string;
      city: string;
      address: string;
    }
  ) => Promise<void>;
  onDeleteBranch: (id: string) => Promise<void>;
}

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `WMC-${suffix}`;
}

export function ManageAccounts({
  currentUser,
  branches,
  users,
  onCreateUser,
  onDeleteUser,
  onCreateBranch,
  onUpdateBranch,
  onDeleteBranch,
}: ManageAccountsProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'branches'>('users');

  // Form User
  const [role, setRole] = useState<UserRole>('leader');
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userFeedback, setUserFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [issuedCredential, setIssuedCredential] = useState<{
    role: UserRole;
    fullName: string;
    identifier: string;
    secret: string;
    branchLabel: string;
  } | null>(null);
  const [copiedCred, setCopiedCred] = useState(false);

  // Form Branch (Create & Edit)
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
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
    setIssuedCredential(null);

    const cleanId = identifier.trim().toLowerCase();
    if (role === 'admin' && !cleanId.endsWith(WM_ADMIN_DOMAIN)) {
      setUserFeedback({
        type: 'err',
        text: `Akun Admin wajib menggunakan email ${WM_ADMIN_DOMAIN}.`,
      });
      return;
    }

    const chosenBranchId = role === 'leader' ? branchId || branches[0]?.id || null : null;
    const chosenBranch = branches.find((b) => b.id === chosenBranchId);

    const cleanSecret = role === 'leader' ? secret.trim() : secret;

    setUserSubmitting(true);
    try {
      const created = await onCreateUser({
        identifier: cleanId,
        fullName: fullName.trim(),
        role,
        branchId: chosenBranchId,
        secret: cleanSecret,
      });

      setIssuedCredential({
        role,
        fullName: fullName.trim(),
        identifier: created?.identifier ?? cleanId,
        secret: cleanSecret,
        branchLabel: chosenBranch ? `${chosenBranch.name} (${chosenBranch.code})` : 'Semua Cabang',
      });

      setFullName('');
      setIdentifier('');
      setSecret('');
      setShowSecret(false);
      setUserFeedback({
        type: 'ok',
        text:
          role === 'leader'
            ? 'Akun Leader berhasil dibuat. Simpan dan berikan username serta kode akses di bawah ini.'
            : 'Akun Admin WM Center berhasil dibuat.',
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

  async function handleCopyCredential() {
    if (!issuedCredential) return;
    const text =
      issuedCredential.role === 'leader'
        ? `Portal WM Center (Leader)\nNama: ${issuedCredential.fullName}\nCabang: ${issuedCredential.branchLabel}\nUsername: ${issuedCredential.identifier}\nKode Akses: ${issuedCredential.secret}`
        : `Portal WM Center (Admin)\nNama: ${issuedCredential.fullName}\nEmail: ${issuedCredential.identifier}\nPassword: ${issuedCredential.secret}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCred(true);
      setTimeout(() => setCopiedCred(false), 2000);
    } catch {
      // abaikan jika clipboard diblokir
    }
  }

  function startEditBranch(branch: Branch) {
    setEditingBranchId(branch.id);
    setBCode(branch.code);
    setBName(branch.name);
    setBCity(branch.city);
    setBAddress(branch.address);
    setBranchFeedback(null);
  }

  function cancelEditBranch() {
    setEditingBranchId(null);
    setBCode('');
    setBName('');
    setBCity('');
    setBAddress('');
  }

  async function handleBranchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBranchFeedback(null);
    setBranchSubmitting(true);
    try {
      const payload = {
        code: bCode.trim().toUpperCase(),
        name: bName.trim(),
        city: bCity.trim(),
        address: bAddress.trim(),
      };

      if (editingBranchId) {
        await onUpdateBranch(editingBranchId, payload);
        setBranchFeedback({ type: 'ok', text: 'Perubahan cabang berhasil disimpan.' });
        cancelEditBranch();
      } else {
        await onCreateBranch(payload);
        setBCode('');
        setBName('');
        setBCity('');
        setBAddress('');
        setBranchFeedback({ type: 'ok', text: 'Cabang WM Center baru berhasil ditambahkan.' });
      }
    } catch (err) {
      setBranchFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan data cabang.',
      });
    } finally {
      setBranchSubmitting(false);
    }
  }

  async function handleDeleteBranchClick(branch: Branch) {
    setBranchFeedback(null);
    try {
      await onDeleteBranch(branch.id);
      if (editingBranchId === branch.id) cancelEditBranch();
      setBranchFeedback({ type: 'ok', text: `Cabang ${branch.name} berhasil dihapus.` });
    } catch (err) {
      setBranchFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menghapus cabang.',
      });
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Segmented Tab Control */}
      <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-md">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'users'
              ? 'bg-[#033367] text-white'
              : 'text-slate-600 hover:text-[#0A172E]'
          }`}
        >
          Akun ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('branches')}
          className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'branches'
              ? 'bg-[#033367] text-white'
              : 'text-slate-600 hover:text-[#0A172E]'
          }`}
        >
          Cabang ({branches.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Form Tambah Akun */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <h2 className="text-base font-semibold text-[#0A172E]">Buat Akun Pengguna</h2>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Leader masuk menggunakan username dan kode akses khusus cabangnya. Admin masuk
              menggunakan email <span className="font-mono">{WM_ADMIN_DOMAIN}</span>.
            </p>

            {userFeedback && (
              <div
                role="status"
                className={`mt-4 rounded-md border px-3.5 py-2.5 text-xs ${
                  userFeedback.type === 'ok'
                    ? 'border-[#033367]/20 bg-[#033367]/5 text-[#033367]'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {userFeedback.text}
              </div>
            )}

            {/* Kotak Kredensial Sekali Tampil untuk Disalin Admin */}
            {issuedCredential && (
              <div className="mt-4 rounded-md border border-slate-300 bg-[#F7F9FC] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#0A172E]">
                    Kredensial Siap Dibagikan
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCredential}
                    className="text-xs font-semibold text-[#033367] hover:underline"
                  >
                    {copiedCred ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
                <div className="text-xs text-slate-600 space-y-1 font-mono">
                  <div>
                    {issuedCredential.role === 'leader' ? 'Username' : 'Email'}:{' '}
                    <span className="text-[#0A172E] font-medium">{issuedCredential.identifier}</span>
                  </div>
                  <div>
                    {issuedCredential.role === 'leader' ? 'Kode Akses' : 'Password'}:{' '}
                    <span className="text-[#0A172E] font-medium">{issuedCredential.secret}</span>
                  </div>
                  <div className="font-sans text-slate-500">{issuedCredential.branchLabel}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleUserSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRole('leader');
                    setIdentifier('');
                    setSecret('');
                  }}
                  className={`min-h-[38px] rounded-md border text-xs font-semibold transition-colors ${
                    role === 'leader'
                      ? 'bg-[#033367] border-[#033367] text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Leader Cabang
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRole('admin');
                    setIdentifier('');
                    setSecret('');
                  }}
                  className={`min-h-[38px] rounded-md border text-xs font-semibold transition-colors ${
                    role === 'admin'
                      ? 'bg-[#033367] border-[#033367] text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Admin WM Center
                </button>
              </div>

              <div>
                <label htmlFor="acc-fullname" className="block text-xs font-medium text-[#0A172E]">
                  Nama Lengkap
                </label>
                <input
                  id="acc-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Nadia Kusuma"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                />
              </div>

              <div>
                <label htmlFor="acc-id" className="block text-xs font-medium text-[#0A172E]">
                  {role === 'admin' ? `Email (${WM_ADMIN_DOMAIN})` : 'Username Leader'}
                </label>
                <input
                  id="acc-id"
                  type={role === 'admin' ? 'email' : 'text'}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={role === 'admin' ? 'nama@wmcenter.id' : 'Contoh: leader.kemang'}
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
                />
              </div>

              {role === 'leader' && (
                <div>
                  <label htmlFor="acc-branch" className="block text-xs font-medium text-[#0A172E]">
                    Cabang Penempatan
                  </label>
                  <select
                    id="acc-branch"
                    required
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="acc-secret" className="block text-xs font-medium text-[#0A172E]">
                    {role === 'leader' ? 'Kode Akses Cabang' : 'Password'}
                  </label>
                  {role === 'leader' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSecret(generateAccessCode());
                        setShowSecret(true);
                      }}
                      className="text-xs font-semibold text-[#033367] hover:underline"
                    >
                      Buat Kode Acak
                    </button>
                  )}
                </div>
                <div className="mt-1 relative">
                  <input
                    id="acc-secret"
                    type={showSecret ? 'text' : 'password'}
                    required
                    minLength={role === 'admin' ? 8 : 6}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={
                      role === 'leader' ? 'Minimal 6 karakter (mis. WMC-7K4P92)' : 'Minimal 8 karakter'
                    }
                    className="block w-full min-h-[42px] rounded-md border border-slate-300 pl-3 pr-11 py-2 text-sm font-mono text-[#0A172E] focus:border-[#033367] focus:outline-none focus:ring-2 focus:ring-[#033367]/15"
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

              <button
                type="submit"
                disabled={userSubmitting}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium text-white bg-[#033367] rounded-md hover:bg-[#0A172E] disabled:opacity-60 transition-colors"
              >
                {userSubmitting ? 'Menyimpan...' : 'Simpan Akun'}
              </button>
            </form>
          </section>

          {/* Daftar Pengguna */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-[#0A172E]">Daftar Akun Terdaftar</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Keluar lalu masuk di tab Leader menggunakan username & kode akses untuk menguji
                batasan cabang.
              </p>
            </div>

            <div className="md:hidden divide-y divide-slate-200">
              {users.map((u) => (
                <div key={u.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-[#0A172E] truncate">{u.fullName}</div>
                    <div className="text-xs font-mono text-slate-500 truncate">{u.identifier}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      <span className="font-medium text-[#033367]">
                        {u.role === 'admin' ? 'Admin' : 'Leader'}
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
                        className="text-xs font-medium text-rose-700 hover:underline py-1"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <th className="py-3 pl-5 pr-3">Nama & Akun</th>
                    <th className="py-3 px-3">Peran & Cabang</th>
                    <th className="py-3 px-3 whitespace-nowrap">Dibuat</th>
                    <th className="py-3 pl-3 pr-5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3">
                        <div className="font-medium text-[#0A172E]">{u.fullName}</div>
                        <div className="text-xs font-mono text-slate-500">{u.identifier}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">
                        <span className="font-semibold text-[#033367]">
                          {u.role === 'admin' ? 'Admin' : 'Leader'}
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
                      <td className="py-3 pl-3 pr-5 text-right text-xs">
                        {u.id === currentUser.id ? (
                          <span className="text-slate-400">Aktif</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDeleteUser(u.id)}
                            className="font-medium text-rose-700 hover:underline"
                          >
                            Hapus
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
          {/* Form Tambah / Edit Cabang */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#0A172E]">
                {editingBranchId ? 'Edit Data Cabang' : 'Tambah Cabang WM Center'}
              </h2>
              {editingBranchId && (
                <button
                  type="button"
                  onClick={cancelEditBranch}
                  className="text-xs font-medium text-slate-500 hover:text-[#0A172E]"
                >
                  Batal Edit
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Kelola daftar lokasi klinik WM Center untuk laporan dan penempatan Leader.
            </p>

            {branchFeedback && (
              <div
                role="status"
                className={`mt-4 rounded-md border px-3.5 py-2.5 text-xs ${
                  branchFeedback.type === 'ok'
                    ? 'border-[#033367]/20 bg-[#033367]/5 text-[#033367]'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {branchFeedback.text}
              </div>
            )}

            <form onSubmit={handleBranchSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="br-code" className="block text-xs font-medium text-[#0A172E]">
                    Kode Cabang
                  </label>
                  <input
                    id="br-code"
                    type="text"
                    required
                    value={bCode}
                    onChange={(e) => setBCode(e.target.value)}
                    placeholder="Contoh: WM-TND"
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase text-[#0A172E] focus:border-[#033367] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="br-city" className="block text-xs font-medium text-[#0A172E]">
                    Kota / Wilayah
                  </label>
                  <input
                    id="br-city"
                    type="text"
                    required
                    value={bCity}
                    onChange={(e) => setBCity(e.target.value)}
                    placeholder="Contoh: Jakarta Selatan"
                    className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="br-name" className="block text-xs font-medium text-[#0A172E]">
                  Nama Cabang
                </label>
                <input
                  id="br-name"
                  type="text"
                  required
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  placeholder="Contoh: WM Center Tendean"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="br-addr" className="block text-xs font-medium text-[#0A172E]">
                  Alamat
                </label>
                <input
                  id="br-addr"
                  type="text"
                  value={bAddress}
                  onChange={(e) => setBAddress(e.target.value)}
                  placeholder="Contoh: Jl. Kapten Tendean, Jakarta Selatan"
                  className="mt-1 block w-full min-h-[42px] rounded-md border border-slate-300 px-3 py-2 text-sm text-[#0A172E] focus:border-[#033367] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={branchSubmitting}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium text-white bg-[#033367] rounded-md hover:bg-[#0A172E] disabled:opacity-60 transition-colors"
              >
                {branchSubmitting
                  ? 'Menyimpan...'
                  : editingBranchId
                    ? 'Simpan Perubahan Cabang'
                    : 'Tambah Cabang'}
              </button>
            </form>
          </section>

          {/* Daftar Cabang dengan Edit & Hapus */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-[#0A172E]">Jaringan Cabang WM Center</h2>
            </div>

            <div className="md:hidden divide-y divide-slate-200">
              {branches.map((b) => (
                <div key={b.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-[#0A172E]">{b.name}</span>
                    <span className="font-mono text-xs text-slate-500">{b.code}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {b.city}
                    {b.address ? ` · ${b.address}` : ''}
                  </div>
                  <div className="pt-1 flex items-center justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => startEditBranch(b)}
                      className="font-medium text-[#033367] hover:underline"
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBranchClick(b)}
                      className="font-medium text-rose-700 hover:underline"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <th className="py-3 pl-5 pr-3">Kode</th>
                    <th className="py-3 px-3">Cabang & Alamat</th>
                    <th className="py-3 px-3">Kota</th>
                    <th className="py-3 pl-3 pr-5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {branches.map((b) => (
                    <tr
                      key={b.id}
                      className={
                        editingBranchId === b.id ? 'bg-[#033367]/5' : 'hover:bg-slate-50/70'
                      }
                    >
                      <td className="py-3 pl-5 pr-3 font-mono text-xs font-medium text-[#033367] whitespace-nowrap align-top">
                        {b.code}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <div className="font-medium text-[#0A172E]">{b.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{b.address || '-'}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap align-top">
                        {b.city}
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap align-top text-xs">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => startEditBranch(b)}
                            className="font-medium text-[#033367] hover:underline"
                          >
                            Ubah
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBranchClick(b)}
                            className="font-medium text-rose-700 hover:underline"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
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
