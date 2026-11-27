import type {
  AppScriptConfigState,
  AuthBootstrapStatus,
  Branch,
  BranchReport,
  ReportPayload,
  ReportStatus,
  UserProfile,
  UserRole,
} from '../types';

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    token?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'WM-Portal',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : `Permintaan gagal (${res.status}).`;
    if (res.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  getAuthStatus(): Promise<AuthBootstrapStatus> {
    return request<AuthBootstrapStatus>('/api/auth/status');
  },

  getSession(): Promise<{ authenticated: boolean; user: UserProfile | null }> {
    return request('/api/auth/session');
  },

  bootstrapAdmin(payload: {
    email: string;
    fullName: string;
    password: string;
  }): Promise<{ token: string; user: UserProfile }> {
    return request('/api/auth/bootstrap', { method: 'POST', body: payload });
  },

  login(payload: {
    loginType: UserRole;
    identifier: string;
    secret: string;
  }): Promise<{ token: string; user: UserProfile }> {
    return request('/api/auth/login', { method: 'POST', body: payload });
  },

  logout(token?: string | null): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST', token });
  },

  getBranches(token?: string | null, options?: { refresh?: boolean }): Promise<{ branches: Branch[] }> {
    const query = options?.refresh ? '?refresh=1' : '';
    return request(`/api/branches${query}`, { token });
  },

  createBranch(
    token: string | null,
    payload: { code: string; name: string; city: string; address: string }
  ): Promise<{ branch: Branch }> {
    return request('/api/branches', { method: 'POST', token, body: payload });
  },

  updateBranch(
    token: string | null,
    id: string,
    payload: { code: string; name: string; city: string; address: string }
  ): Promise<{ branch: Branch }> {
    return request(`/api/branches/${encodeURIComponent(id)}`, {
      method: 'PUT',
      token,
      body: payload,
    });
  },

  deleteBranch(token: string | null, id: string): Promise<{ ok: boolean; deletedId: string }> {
    return request(`/api/branches/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  getReports(
    token?: string | null,
    branchId?: string,
    options?: { refresh?: boolean }
  ): Promise<{ reports: BranchReport[] }> {
    const params = new URLSearchParams();
    if (branchId && branchId !== 'all') {
      params.set('branchId', branchId);
    }
    if (options?.refresh) {
      params.set('refresh', '1');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/reports${query}`, { token });
  },

  createReport(token: string | null, payload: ReportPayload): Promise<{ report: BranchReport }> {
    return request('/api/reports', { method: 'POST', token, body: payload });
  },

  updateReport(
    token: string | null,
    id: string,
    payload: ReportPayload
  ): Promise<{ report: BranchReport }> {
    return request(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      token,
      body: payload,
    });
  },

  updateReportStatus(
    token: string | null,
    id: string,
    payload: { status: ReportStatus; reviewNote: string }
  ): Promise<{ report: BranchReport }> {
    return request(`/api/reports/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      token,
      body: payload,
    });
  },

  deleteReport(token: string | null, id: string): Promise<{ ok: boolean; deletedId: string }> {
    return request(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  async downloadReportAttachment(
    token: string | null,
    id: string,
    fallbackFileName?: string
  ): Promise<void> {
    const headers: Record<string, string> = {
      'X-Requested-With': 'WM-Portal',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`/api/reports/${encodeURIComponent(id)}/attachment`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message =
        typeof data?.error === 'string'
          ? data.error
          : `Gagal mengunduh lampiran PDF (${res.status}).`;
      if (res.status === 401) {
        throw new UnauthorizedError(message);
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fallbackFileName || `lampiran-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  },

  getUsers(token?: string | null, options?: { refresh?: boolean }): Promise<{ users: UserProfile[] }> {
    const query = options?.refresh ? '?refresh=1' : '';
    return request(`/api/users${query}`, { token });
  },

  createUser(
    token: string | null,
    payload: {
      identifier: string;
      fullName: string;
      role: UserRole;
      branchId: string | null;
      secret: string;
    }
  ): Promise<{ user: UserProfile }> {
    return request('/api/users', { method: 'POST', token, body: payload });
  },

  deleteUser(token: string | null, id: string): Promise<{ ok: boolean; deletedId: string }> {
    return request(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  getAppScriptCode(token?: string | null): Promise<{ filename: string; code: string }> {
    return request('/api/appscript/code', { token });
  },

  getAppScriptConfig(token?: string | null): Promise<AppScriptConfigState> {
    return request('/api/appscript/config', { token });
  },

  testAppScriptConnection(
    token: string | null,
    url: string
  ): Promise<{ ok: boolean; spreadsheetName: string; initialized: boolean }> {
    return request('/api/appscript/test', { method: 'POST', token, body: { url } });
  },

  saveAppScriptConfig(
    token: string | null,
    payload: { mode: 'local' | 'appscript'; url: string }
  ): Promise<AppScriptConfigState & { reloginRequired: boolean }> {
    return request('/api/appscript/config', { method: 'POST', token, body: payload });
  },
};
