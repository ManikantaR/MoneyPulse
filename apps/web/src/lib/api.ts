const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/** Allowed types for individual query parameter values. */
export type QueryParamValue = string | number | boolean | undefined;

/** Generic query parameter map accepted by api.get(). */
export type QueryParams = Record<string, QueryParamValue>;

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: QueryParams;
}

class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public error?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Build a URL with optional query parameters. */
function buildUrl(
  path: string,
  params?: QueryParams,
): string {
  const base = `${API_BASE}${path}`;
  if (!params) return base;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function request<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { body, params, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  const res = await fetch(buildUrl(path, params), {
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (res.status === 401) {
    // Try refresh
    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      // Retry original request with refreshed token
      const retryRes = await fetch(buildUrl(path, params), {
        credentials: 'include',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        ...rest,
      });

      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({}));
        throw new ApiError(
          retryRes.status,
          err.message || 'Request failed',
          err.error,
        );
      }

      return retryRes.json();
    }

    // Refresh also failed — redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.message || 'Request failed', err.error);
  }

  return res.json();
}

/** Upload a file via multipart form data (no JSON Content-Type header). */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Try refresh
    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      // Retry upload with refreshed token
      const retryRes = await fetch(buildUrl(path), {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ message: retryRes.statusText }));
        throw new ApiError(retryRes.status, err.message || retryRes.statusText, err.error);
      }

      return retryRes.json();
    }

    // Refresh also failed — redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err.error);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string, options?: { params?: QueryParams }) =>
    request<T>(path, { method: 'GET', params: options?.params }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
};

export { ApiError };
