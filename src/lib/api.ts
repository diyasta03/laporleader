import type {
  AppScriptConfigState,
  AuthBootstrapStatus,
  Branch,
  BranchReport,
  ReportPayload,
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
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    token?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
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

  bootstrapAdmin(payload: {
    username: string;
    fullName: string;
    password: string;
  }): Promise<{ token: string; user: UserProfile }> {
    return request('/api/auth/bootstrap', { method: 'POST', body: payload });
  },

  login(payload: {
    username: string;
    password: string;
  }): Promise<{ token: string; user: UserProfile }> {
    return request('/api/auth/login', { method: 'POST', body: payload });
  },

  logout(token: string): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST', token });
  },

  getBranches(token: string): Promise<{ branches: Branch[] }> {
    return request('/api/branches', { token });
  },

  createBranch(
    token: string,
    payload: { code: string; name: string; city: string; address: string }
  ): Promise<{ branch: Branch }> {
    return request('/api/branches', { method: 'POST', token, body: payload });
  },

  getReports(token: string, branchId?: string): Promise<{ reports: BranchReport[] }> {
    const query =
      branchId && branchId !== 'all'
        ? `?branchId=${encodeURIComponent(branchId)}`
        : '';
    return request(`/api/reports${query}`, { token });
  },

  createReport(token: string, payload: ReportPayload): Promise<{ report: BranchReport }> {
    return request('/api/reports', { method: 'POST', token, body: payload });
  },

  updateReport(
    token: string,
    id: string,
    payload: ReportPayload
  ): Promise<{ report: BranchReport }> {
    return request(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      token,
      body: payload,
    });
  },

  deleteReport(token: string, id: string): Promise<{ ok: boolean; deletedId: string }> {
    return request(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  getUsers(token: string): Promise<{ users: UserProfile[] }> {
    return request('/api/users', { token });
  },

  createUser(
    token: string,
    payload: {
      username: string;
      fullName: string;
      role: UserRole;
      branchId: string | null;
      password: string;
    }
  ): Promise<{ user: UserProfile }> {
    return request('/api/users', { method: 'POST', token, body: payload });
  },

  deleteUser(token: string, id: string): Promise<{ ok: boolean; deletedId: string }> {
    return request(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  getAppScriptCode(token: string): Promise<{ filename: string; code: string }> {
    return request('/api/appscript/code', { token });
  },

  getAppScriptConfig(token: string): Promise<AppScriptConfigState> {
    return request('/api/appscript/config', { token });
  },

  testAppScriptConnection(
    token: string,
    url: string
  ): Promise<{ ok: boolean; spreadsheetName: string; initialized: boolean }> {
    return request('/api/appscript/test', { method: 'POST', token, body: { url } });
  },

  saveAppScriptConfig(
    token: string,
    payload: { mode: 'local' | 'appscript'; url: string }
  ): Promise<AppScriptConfigState & { reloginRequired: boolean }> {
    return request('/api/appscript/config', { method: 'POST', token, body: payload });
  },
};
