const TOKEN_KEY = "bettererp_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    if (typeof options.body !== "string") options = { ...options, body: JSON.stringify(options.body) };
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && !path.includes("/auth/login")) {
    setToken(null);
    window.dispatchEvent(new Event("auth:expired"));
  }
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
    const url = new URL(path, window.location.origin);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return request<T>(`${url.pathname}${url.search}`);
  },
  post<T>(path: string, body?: unknown) {
    return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  },
  put<T>(path: string, body?: unknown) {
    return request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
  },
  del<T>(path: string) {
    return request<T>(path, { method: "DELETE" });
  },
};

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}