// TASK-031 — In-memory access JWT store (AD-6).
//
// AD-6 requires the PWA to hold the access JWT in memory (not localStorage,
// not sessionStorage) so XSS cannot exfiltrate a long-lived credential. The
// httpOnly refresh cookie is the durable artefact; when the access token
// expires, the fetch wrapper calls /api/v1/auth/refresh to mint a new one.
//
// This module is a tiny singleton — subscribers re-render when the token
// changes so the UI can react (sign-out on refresh failure, etc.).

import type { Role } from '@tp/types';

export interface AuthUser {
  id: string;
  restaurant_id: string;
  email: string;
  role: Role;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

type Listener = (session: AuthSession | null) => void;

let session: AuthSession | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get(): AuthSession | null {
    return session;
  },
  set(next: AuthSession | null): void {
    session = next;
    for (const l of listeners) l(session);
  },
  clear(): void {
    this.set(null);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
