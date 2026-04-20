// TASK-031 — Auth API client (AD-6).
//
// Wraps fetch so every request:
//   1. Attaches `Authorization: Bearer <access JWT>` from the in-memory store.
//   2. Sends cookies (credentials: 'include') so the refresh cookie roundtrips.
//   3. On 401 + access token present, tries POST /auth/refresh exactly once
//      and retries the original request. A failed refresh clears the store.
//
// All endpoints return the `{ data, error }` envelope from the API.

import { tokenStore, type AuthSession, type AuthUser } from './TokenStore.js';

export interface ApiError { code: string; message: string }
export interface ApiEnvelope<T> { data: T | null; error: ApiError | null }

const BASE = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '';

async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const session = tokenStore.get();
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (res.status === 204) return { data: null, error: null };
  return (await res.json()) as ApiEnvelope<T>;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const body = (await res.json()) as ApiEnvelope<{ accessToken: string; user: AuthUser }>;
      if (!body.data) {
        tokenStore.clear();
        return false;
      }
      tokenStore.set({ accessToken: body.data.accessToken, user: body.data.user });
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const first = await rawFetch<T>(path, init);
  const shouldRetry =
    first.error?.code === 'UNAUTHORIZED' ||
    (first.error == null && (init as { __status?: number }).__status === 401);
  if (!shouldRetry) return first;
  const refreshed = await refresh();
  if (!refreshed) return first;
  return rawFetch<T>(path, init);
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const body = await rawFetch<{ accessToken: string; user: AuthUser }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!body.data) {
    throw new Error(body.error?.message ?? 'login failed');
  }
  const session = { accessToken: body.data.accessToken, user: body.data.user };
  tokenStore.set(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    tokenStore.clear();
  }
}

export async function forgotPassword(email: string): Promise<void> {
  await fetch(`${BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function tryRestoreSession(): Promise<boolean> {
  return refresh();
}
