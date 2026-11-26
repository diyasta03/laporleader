import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ClipboardList,
  Code2,
  FilePlus2,
  LogOut,
  Menu,
  Users,
  X,
} from 'lucide-react';
import { api, UnauthorizedError } from './lib/api';
import type {
  AuthBootstrapStatus,
  Branch,
  BranchReport,
  ReportPayload,
  UserProfile,
  UserRole,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { ReportHistory } from './components/ReportHistory';
import { ReportForm } from './components/ReportForm';
import { ManageAccounts } from './components/ManageAccounts';
import { AppScriptPanel } from './components/AppScriptPanel';

type ActiveView = 'history' | 'create' | 'edit' | 'accounts' | 'appscript';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthBootstrapStatus | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Token sesi disimpan ketat di memori React (tidak di localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('history');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<BranchReport[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editingReport, setEditingReport] = useState<BranchReport | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const fetchAuthStatus = useCallback(async () => {
    setBootError(null);
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Gagal menghubungi server aplikasi.');
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Tutup drawer mobile saat ukuran layar melebar ke desktop atau tombol Escape ditekan
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const resetSessionToLogin = useCallback(
    (message?: string) => {
      setToken(null);
      setUser(null);
      setBranches([]);
      setReports([]);
      setUsers([]);
      setEditingReport(null);
      setActiveView('history');
      setMobileMenuOpen(false);
      setDataError(null);
      setAuthNotice(message ?? null);
      fetchAuthStatus();
    },
    [fetchAuthStatus]
  );

  const handleApiError = useCallback(
    (err: unknown): boolean => {
      if (err instanceof UnauthorizedError) {
        resetSessionToLogin('Sesi Anda telah berakhir. Silakan masuk kembali.');
        return true;
      }
      return false;
    },
    [resetSessionToLogin]
  );

  const loadWorkspaceData = useCallback(
    async (authToken: string, currentUser: UserProfile) => {
      setLoadingData(true);
      setDataError(null);
      try {
        const [branchRes, reportRes] = await Promise.all([
          api.getBranches(authToken),
          api.getReports(authToken),
        ]);
        setBranches(branchRes.branches);
        setReports(reportRes.reports);

        if (currentUser.role === 'admin') {
          const usersRes = await api.getUsers(authToken);
          setUsers(usersRes.users);
        } else {
          setUsers([]);
        }
      } catch (err) {
        if (handleApiError(err)) return;
        setDataError(err instanceof Error ? err.message : 'Gagal memuat data operasional.');
      } finally {
        setLoadingData(false);
      }
    },
    [handleApiError]
  );

  function handleAuthenticated(nextToken: string, nextUser: UserProfile) {
    setAuthNotice(null);
    setToken(nextToken);
    setUser(nextUser);
    setActiveView('history');
    setEditingReport(null);
    loadWorkspaceData(nextToken, nextUser);
  }

  async function handleLogout(notice?: string) {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // abaikan kegagalan jaringan saat logout
      }
    }
    resetSessionToLogin(notice ?? 'Anda telah keluar dari sistem.');
  }

  async function handleSubmitReport(payload: ReportPayload, editId?: string) {
    if (!token) return;
    try {
      if (editId) {
        const res = await api.updateReport(token, editId, payload);
        setReports((prev) => prev.map((r) => (r.id === editId ? res.report : r)));
        setEditingReport(null);
        setActiveView('history');
      } else {
        const res = await api.createReport(token, payload);
        setReports((prev) => [res.report, ...prev]);
      }
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleDeleteReport(id: string) {
    if (!token) return;
    try {
      await api.deleteReport(token, id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleCreateUser(payload: {
    username: string;
    fullName: string;
    role: UserRole;
    branchId: string | null;
    password: string;
  }) {
    if (!token) return;
    try {
      const res = await api.createUser(token, payload);
      setUsers((prev) => [...prev, res.user]);
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleDeleteUser(id: string) {
    if (!token) return;
    try {
      await api.deleteUser(token, id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleCreateBranch(payload: {
    code: string;
    name: string;
    city: string;
    address: string;
  }) {
    if (!token) return;
    try {
      const res = await api.createBranch(token, payload);
      setBranches((prev) => [...prev, res.branch]);
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  if (bootError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 text-slate-900">
            <Building2 className="w-5 h-5 text-teal-700 shrink-0" />
            <span className="font-display font-bold">LaporCabang</span>
          </div>
          <h1 className="mt-4 text-base font-semibold text-slate-900">Gagal Menghubungi Server</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">{bootError}</p>
          <button
            type="button"
            onClick={fetchAuthStatus}
            className="mt-5 w-full sm:w-auto min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Memuat LaporCabang...
      </div>
    );
  }

  if (!token || !user) {
    return (
      <AuthScreen
        status={authStatus}
        notice={authNotice}
        onClearNotice={() => setAuthNotice(null)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const isAdmin = user.role === 'admin';

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly?: boolean;
  }> = [
    {
      id: 'history',
      label: isAdmin ? 'Riwayat Semua Cabang' : 'Riwayat Cabang',
      icon: ClipboardList,
    },
    {
      id: 'create',
      label: isAdmin ? 'Form Laporan Cabang' : 'Isi Laporan',
      icon: FilePlus2,
    },
    {
      id: 'accounts',
      label: 'Akun & Cabang',
      icon: Users,
      adminOnly: true,
    },
    {
      id: 'appscript',
      label: 'Integrasi Apps Script',
      icon: Code2,
      adminOnly: true,
    },
  ];

  const visibleNav = navItems.filter((item) => !item.adminOnly || isAdmin);

  const pageTitleMap: Record<ActiveView, string> = {
    history: isAdmin ? 'Riwayat Semua Cabang' : `Riwayat ${user.branchName ?? 'Cabang'}`,
    create: isAdmin ? 'Input Laporan Cabang' : `Isi Laporan ${user.branchName ?? ''}`,
    edit: 'Ubah Laporan',
    accounts: 'Akun & Cabang',
    appscript: 'Integrasi Apps Script',
  };

  function navigateTo(view: ActiveView) {
    setActiveView(view);
    if (view !== 'edit') setEditingReport(null);
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/35 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigasi (260px desktop, drawer responsif mobile) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-dvh w-[264px] max-w-[82vw] shrink-0 bg-white border-r border-slate-200 flex flex-col transition-transform duration-150 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-14 sm:h-16 px-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-slate-900 min-w-0">
            <Building2 className="w-5 h-5 text-teal-700 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
              LaporCabang
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-2 -mr-1.5 text-slate-500 hover:text-slate-900 rounded-md"
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Navigasi utama">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeView === item.id || (activeView === 'edit' && item.id === 'history');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-teal-700' : 'text-slate-400'}`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Profil Pengguna & Keluar */}
        <div className="p-4 border-t border-slate-200">
          <div className="text-sm font-semibold text-slate-900 truncate">{user.fullName}</div>
          <div className="mt-0.5 text-xs text-slate-500 truncate">
            <span>{isAdmin ? 'Admin Pusat' : 'Leader'}</span>
            <span className="mx-1.5" aria-hidden="true">
              ·
            </span>
            <span>{isAdmin ? 'Semua Cabang' : user.branchCode ?? '-'}</span>
          </div>
          {!isAdmin && user.branchName && (
            <div className="mt-0.5 text-xs text-slate-500 truncate">{user.branchName}</div>
          )}

          <button
            type="button"
            onClick={() => handleLogout()}
            className="mt-3.5 w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Area Utama */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar: <=15% mobile height cap (56px mobile, 64px desktop) */}
        <header className="sticky top-0 z-20 h-14 sm:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden md:inline text-slate-400 whitespace-nowrap">
                {isAdmin ? 'Admin Pusat' : user.branchName ?? 'Cabang'}
              </span>
              <span className="hidden md:inline text-slate-300">/</span>
              <h1 className="font-semibold text-slate-900 truncate text-sm sm:text-base">
                {pageTitleMap[activeView]}
              </h1>
            </div>
          </div>

          <div className="shrink-0">
            {activeView === 'history' ? (
              <button
                type="button"
                onClick={() => navigateTo('create')}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
                <span>Tulis Laporan</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateTo('history')}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                <span>Riwayat</span>
              </button>
            )}
          </div>
        </header>

        {/* Konten Utama */}
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 max-w-7xl w-full mx-auto">
          {dataError && (
            <div
              role="alert"
              className="mb-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex flex-wrap items-center justify-between gap-3"
            >
              <span>{dataError}</span>
              <button
                type="button"
                onClick={() => loadWorkspaceData(token, user)}
                className="text-xs font-semibold text-rose-900 underline whitespace-nowrap"
              >
                Muat Ulang
              </button>
            </div>
          )}

          {activeView === 'history' && (
            <ReportHistory
              user={user}
              branches={branches}
              reports={reports}
              loading={loadingData}
              onCreateNew={() => navigateTo('create')}
              onEditReport={(report) => {
                setEditingReport(report);
                setActiveView('edit');
              }}
              onDeleteReport={handleDeleteReport}
            />
          )}

          {activeView === 'create' && (
            <ReportForm
              user={user}
              branches={branches}
              onSubmit={handleSubmitReport}
              onCancel={() => navigateTo('history')}
            />
          )}

          {activeView === 'edit' && isAdmin && editingReport && (
            <ReportForm
              user={user}
              branches={branches}
              editingReport={editingReport}
              onSubmit={handleSubmitReport}
              onCancel={() => {
                setEditingReport(null);
                setActiveView('history');
              }}
            />
          )}

          {activeView === 'accounts' && isAdmin && (
            <ManageAccounts
              currentUser={user}
              branches={branches}
              users={users}
              onCreateUser={handleCreateUser}
              onDeleteUser={handleDeleteUser}
              onCreateBranch={handleCreateBranch}
            />
          )}

          {activeView === 'appscript' && isAdmin && (
            <AppScriptPanel
              token={token}
              onModeSwitchedToAppScript={() =>
                handleLogout(
                  'Mode Google Apps Script aktif. Silakan masuk atau aktifkan akun Admin pada Google Sheets Anda.'
                )
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
