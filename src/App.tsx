import React, { useCallback, useEffect, useState } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { api, UnauthorizedError } from './lib/api';
import type {
  AuthBootstrapStatus,
  Branch,
  BranchReport,
  ReportPayload,
  ReportStatus,
  UserProfile,
  UserRole,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { ReportHistory } from './components/ReportHistory';
import { ReportForm } from './components/ReportForm';
import { ManageAccounts } from './components/ManageAccounts';
import { AppScriptPanel } from './components/AppScriptPanel';

type ActiveView = 'history' | 'create' | 'edit' | 'accounts' | 'appscript';

function isSpreadsheetUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return (
    path === '/spreadsheet' ||
    path === '/appscript' ||
    hash === 'spreadsheet' ||
    hash === 'appscript' ||
    params.get('page') === 'spreadsheet'
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthBootstrapStatus | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Sesi dipulihkan otomatis dari cookie HttpOnly di server; token memori sebagai pelengkap
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('history');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

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
    async (
      authToken: string | null,
      currentUser: UserProfile,
      options?: { forceRefresh?: boolean }
    ) => {
      setLoadingData(true);
      setDataError(null);
      const reqOpts = options?.forceRefresh ? { refresh: true } : undefined;
      try {
        if (currentUser.role === 'admin') {
          const [branchRes, reportRes, usersRes] = await Promise.all([
            api.getBranches(authToken, reqOpts),
            api.getReports(authToken, undefined, reqOpts),
            api.getUsers(authToken, reqOpts),
          ]);
          setBranches(branchRes.branches);
          setReports(reportRes.reports);
          setUsers(usersRes.users);
        } else {
          const [branchRes, reportRes] = await Promise.all([
            api.getBranches(authToken, reqOpts),
            api.getReports(authToken, undefined, reqOpts),
          ]);
          setBranches(branchRes.branches);
          setReports(reportRes.reports);
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

  // Inisialisasi awal: cek sesi lokal (~2ms) dahulu agar refresh langsung tampil tanpa menunggu Apps Script
  const bootstrapPortal = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const sessionRes = await api.getSession();

      if (sessionRes.authenticated && sessionRes.user) {
        setUser(sessionRes.user);
        if (sessionRes.user.role === 'admin' && isSpreadsheetUrl()) {
          setActiveView('appscript');
        }
        setBooting(false);
        void loadWorkspaceData(null, sessionRes.user);
        return;
      }

      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Gagal menghubungi server aplikasi.');
    } finally {
      setBooting(false);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    bootstrapPortal();
  }, [bootstrapPortal]);

  useEffect(() => {
    function syncUrlRoute() {
      if (user?.role === 'admin' && isSpreadsheetUrl()) {
        setActiveView('appscript');
      } else if (activeView === 'appscript' && !isSpreadsheetUrl()) {
        setActiveView('history');
      }
    }
    window.addEventListener('popstate', syncUrlRoute);
    window.addEventListener('hashchange', syncUrlRoute);
    return () => {
      window.removeEventListener('popstate', syncUrlRoute);
      window.removeEventListener('hashchange', syncUrlRoute);
    };
  }, [user, activeView]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleAuthenticated(nextToken: string, nextUser: UserProfile) {
    setAuthNotice(null);
    setToken(nextToken);
    setUser(nextUser);
    setActiveView(nextUser.role === 'admin' && isSpreadsheetUrl() ? 'appscript' : 'history');
    setEditingReport(null);
    loadWorkspaceData(nextToken, nextUser);
  }

  async function handleLogout(notice?: string) {
    try {
      await api.logout(token);
    } catch {
      // abaikan kegagalan jaringan saat logout
    }
    resetSessionToLogin(notice ?? 'Anda telah keluar dari portal WM Center.');
  }

  async function handleSubmitReport(payload: ReportPayload, editId?: string) {
    if (!user) return;
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

  async function handleUpdateReportStatus(
    id: string,
    status: ReportStatus,
    reviewNote: string
  ) {
    if (!user) return;
    try {
      const res = await api.updateReportStatus(token, id, { status, reviewNote });
      setReports((prev) => prev.map((r) => (r.id === id ? res.report : r)));
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleDeleteReport(id: string) {
    if (!user) return;
    try {
      await api.deleteReport(token, id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleDownloadAttachment(reportId: string, fileName?: string) {
    if (!user) return;
    try {
      await api.downloadReportAttachment(token, reportId, fileName);
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleCreateUser(payload: {
    identifier: string;
    fullName: string;
    role: UserRole;
    branchId: string | null;
    secret: string;
  }): Promise<UserProfile | undefined> {
    if (!user) return undefined;
    try {
      const res = await api.createUser(token, payload);
      setUsers((prev) => [...prev, res.user]);
      return res.user;
    } catch (err) {
      if (handleApiError(err)) return undefined;
      throw err;
    }
  }

  async function handleDeleteUser(id: string) {
    if (!user) return;
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
    if (!user) return;
    try {
      const res = await api.createBranch(token, payload);
      setBranches((prev) => [...prev, res.branch]);
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleUpdateBranch(
    id: string,
    payload: {
      code: string;
      name: string;
      city: string;
      address: string;
    }
  ) {
    if (!user) return;
    try {
      const res = await api.updateBranch(token, id, payload);
      setBranches((prev) => prev.map((b) => (b.id === id ? res.branch : b)));
      setReports((prev) =>
        prev.map((r) =>
          r.branchId === id
            ? { ...r, branchName: res.branch.name, branchCode: res.branch.code }
            : r
        )
      );
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  async function handleDeleteBranch(id: string) {
    if (!user) return;
    try {
      await api.deleteBranch(token, id);
      setBranches((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      if (handleApiError(err)) return;
      throw err;
    }
  }

  if (bootError) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-6">
          <div className="font-display font-bold text-[#0A172E]">WM Center</div>
          <h1 className="mt-4 text-base font-semibold text-[#0A172E]">Gagal Menghubungi Server</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">{bootError}</p>
          <button
            type="button"
            onClick={bootstrapPortal}
            className="mt-5 w-full sm:w-auto min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-[#033367] rounded-md hover:bg-[#0A172E] transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (booting || (!user && !authStatus)) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <div className="font-display text-lg font-bold text-[#0A172E]">WM Center</div>
          <p className="text-sm text-slate-500">Memeriksa sesi portal...</p>
        </div>
      </div>
    );
  }

  if (!user && authStatus) {
    return (
      <AuthScreen
        status={authStatus}
        notice={authNotice}
        onClearNotice={() => setAuthNotice(null)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (!user) return null;

  const isAdmin = user.role === 'admin';

  const navItems: Array<{
    id: ActiveView;
    label: string;
    mobileLabel: string;
    adminOnly?: boolean;
  }> = [
    {
      id: 'history',
      label: isAdmin ? 'Dashboard & Riwayat' : 'Riwayat Cabang',
      mobileLabel: isAdmin ? 'Dashboard' : 'Riwayat',
    },
    {
      id: 'create',
      label: isAdmin ? 'Form Laporan Cabang' : 'Isi Laporan',
      mobileLabel: 'Isi Laporan',
    },
    {
      id: 'accounts',
      label: 'Akun & Cabang',
      mobileLabel: 'Akun & Cabang',
      adminOnly: true,
    },
  ];

  const visibleNav = navItems.filter((item) => !item.adminOnly || isAdmin);

  const pageTitleMap: Record<ActiveView, string> = {
    history: isAdmin ? 'Dashboard Laporan Cabang' : `Riwayat ${user.branchName ?? 'Cabang'}`,
    create: isAdmin ? 'Input Laporan Semua Cabang' : `Isi Laporan ${user.branchName ?? ''}`,
    edit: 'Ubah Laporan Kegiatan',
    accounts: 'Akun Leader & Cabang',
    appscript: 'Koneksi Google Spreadsheet',
  };

  function navigateTo(view: ActiveView) {
    setActiveView(view);
    if (view !== 'edit') setEditingReport(null);
    if (view !== 'appscript' && isSpreadsheetUrl()) {
      window.history.replaceState(null, '', '/');
    }
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-[#0A172E]/35 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Minimalis (#0A172E) — bisa dibuka/tutup di desktop & mobile */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-dvh shrink-0 bg-[#0A172E] text-white flex flex-col overflow-hidden transition-all duration-200 ${
          mobileMenuOpen
            ? 'translate-x-0 w-[256px] max-w-[82vw]'
            : '-translate-x-full w-[256px] max-w-[82vw] lg:translate-x-0'
        } ${
          desktopSidebarOpen
            ? 'lg:w-[256px] lg:opacity-100'
            : 'lg:w-0 lg:opacity-0 lg:pointer-events-none'
        }`}
      >
        <div className="w-[256px] max-w-[82vw] h-full flex flex-col">
          <div className="h-14 sm:h-16 px-5 border-b border-white/10 flex items-center justify-between">
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
              WM Center
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-2 -mr-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-md cursor-pointer transition-colors"
              aria-label="Tutup menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Navigasi utama">
            {visibleNav.map((item) => {
              const isActive =
                activeView === item.id || (activeView === 'edit' && item.id === 'history');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full min-h-[42px] text-left px-3.5 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#033367] text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Profil Pengguna */}
          <div className="p-4 border-t border-white/10">
            <div className="text-sm font-semibold text-white truncate">{user.fullName}</div>
            <div className="mt-0.5 text-xs text-white/60 truncate">
              <span>{isAdmin ? 'Admin WM Center' : 'Leader'}</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="font-mono">{isAdmin ? 'Semua Cabang' : user.branchCode ?? '-'}</span>
            </div>
            {!isAdmin && user.branchName && (
              <div className="mt-0.5 text-xs text-white/55 truncate">{user.branchName}</div>
            )}

            <button
              type="button"
              onClick={() => handleLogout()}
              className="mt-4 w-full min-h-[40px] px-3 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Area Utama */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Minimalis */}
        <header className="sticky top-0 z-20 h-14 sm:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-1.5 text-slate-600 hover:text-[#0A172E] hover:bg-slate-100 rounded-md shrink-0 cursor-pointer transition-colors"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setDesktopSidebarOpen((prev) => !prev)}
              aria-expanded={desktopSidebarOpen}
              title={desktopSidebarOpen ? 'Tutup sidebar' : 'Buka sidebar'}
              aria-label={desktopSidebarOpen ? 'Tutup sidebar' : 'Buka sidebar'}
              className="hidden lg:inline-flex items-center justify-center p-2 -ml-2 text-slate-600 hover:text-[#033367] hover:bg-[#EBF2FA] rounded-md shrink-0 cursor-pointer transition-colors"
            >
              {desktopSidebarOpen ? (
                <PanelLeftClose className="w-5 h-5" />
              ) : (
                <PanelLeftOpen className="w-5 h-5" />
              )}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="hidden md:inline text-slate-400 whitespace-nowrap">
                  {isAdmin ? 'Admin WM Center' : user.branchName ?? 'Cabang'}
                </span>
                <span className="hidden md:inline text-slate-300">/</span>
                <h1 className="font-semibold text-[#0A172E] truncate text-sm sm:text-base">
                  {pageTitleMap[activeView]}
                </h1>
              </div>
              <p className="md:hidden text-[11px] text-slate-500 truncate">
                {user.fullName} · {isAdmin ? 'Admin' : user.branchCode ?? 'Leader'}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {activeView === 'history' ? (
              <button
                type="button"
                onClick={() => navigateTo('create')}
                className="min-h-[38px] px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-[#033367] rounded-md hover:bg-[#0A172E] transition-colors whitespace-nowrap shrink-0"
              >
                Tulis Laporan
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateTo('history')}
                className="min-h-[38px] px-3.5 sm:px-4 py-2 text-xs font-semibold text-[#0A172E] bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                Lihat Riwayat
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-6 sm:pb-24 lg:px-8 lg:py-8 lg:pb-8 max-w-7xl w-full mx-auto">
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
              onRefreshData={() => loadWorkspaceData(token, user, { forceRefresh: true })}
              onCreateNew={() => navigateTo('create')}
              onEditReport={(report) => {
                setEditingReport(report);
                setActiveView('edit');
              }}
              onUpdateStatus={handleUpdateReportStatus}
              onDeleteReport={handleDeleteReport}
              onDownloadAttachment={handleDownloadAttachment}
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
              onUpdateBranch={handleUpdateBranch}
              onDeleteBranch={handleDeleteBranch}
            />
          )}
          {activeView === 'appscript' && isAdmin && (
            <AppScriptPanel
              token={token}
              onModeSwitchedToAppScript={() =>
                resetSessionToLogin(
                  'Koneksi Google Spreadsheet aktif. Silakan masuk menggunakan akun Admin/Leader yang terdaftar di Spreadsheet.'
                )
              }
            />
          )}
        </main>

        {/* Mobile Bottom Navigation Bar (< lg) agar navigasi 1 ketukan di ponsel */}
        <nav
          aria-label="Navigasi cepat seluler"
          className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200"
        >
          <div
            className={`grid ${
              visibleNav.length === 4
                ? 'grid-cols-4'
                : visibleNav.length === 3
                ? 'grid-cols-3'
                : 'grid-cols-2'
            } max-w-lg mx-auto`}
          >
            {visibleNav.map((item) => {
              const isActive =
                activeView === item.id || (activeView === 'edit' && item.id === 'history');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`min-h-[54px] px-2 py-2.5 text-xs font-semibold transition-colors border-t-2 ${
                    isActive
                      ? 'border-[#033367] text-[#033367] bg-[#F7F9FC]'
                      : 'border-transparent text-slate-500 hover:text-[#0A172E]'
                  }`}
                >
                  {item.mobileLabel}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
