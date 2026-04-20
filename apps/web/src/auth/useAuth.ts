// TASK-031 — React hook wrapping the in-memory token store.
//
// Components consume this hook rather than touching TokenStore directly, so
// they re-render when the session changes (login, logout, refresh failure).

import { useEffect, useState } from 'react';
import { tokenStore, type AuthSession } from './TokenStore.js';

export function useAuth(): AuthSession | null {
  const [session, setSession] = useState<AuthSession | null>(() => tokenStore.get());
  useEffect(() => tokenStore.subscribe(setSession), []);
  return session;
}
