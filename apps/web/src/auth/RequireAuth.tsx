// TASK-031 — route guard component.
//
// Attempts a silent refresh on mount. If it succeeds, renders children.
// If it fails, redirects to /login with the intended destination captured.

import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.js';
import { tryRestoreSession } from './api.js';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuth();
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (session) {
      setChecked(true);
      return;
    }
    void tryRestoreSession().finally(() => setChecked(true));
  }, [session]);

  if (!checked) return <p style={{ padding: '2rem' }}>Loading…</p>;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
