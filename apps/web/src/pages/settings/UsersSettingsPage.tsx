// User admin UI (§6.11 follow-up). Owner-only — backend RBAC enforces.
//
// Surfaces the existing /api/v1/users routes: list, invite, change role, deactivate
// /reactivate. The invite response includes a one-time resetToken; we display it
// inline because there is no email dispatch yet (docs/adr/0006). Owner copies it
// to share with the new user out-of-band.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../auth/api.js';

type Role = 'owner' | 'manager' | 'staff';
const ROLES: Role[] = ['owner', 'manager', 'staff'];

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface InviteResp {
  user: UserRow;
  resetToken: string;
}

export default function UsersSettingsPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'staff' as Role });
  const [lastReset, setLastReset] = useState<{ email: string; resetToken: string } | null>(null);

  const load = useCallback(async () => {
    const qs = includeInactive ? '?includeInactive=true' : '';
    const res = await apiFetch<UserRow[]>(`/api/v1/users${qs}`);
    if (res.error) setErr(res.error.message);
    else setRows(res.data ?? []);
  }, [includeInactive]);

  useEffect(() => { void load(); }, [load]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLastReset(null);
    const res = await apiFetch<InviteResp>('/api/v1/users/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: invite.email.trim(),
        name: invite.name.trim() || undefined,
        role: invite.role,
      }),
    });
    if (res.error) { setErr(res.error.message); return; }
    if (res.data) {
      setLastReset({ email: res.data.user.email, resetToken: res.data.resetToken });
    }
    setInvite({ email: '', name: '', role: 'staff' });
    void load();
  }

  async function changeRole(row: UserRow, role: Role) {
    if (role === row.role) return;
    const res = await apiFetch<UserRow>(`/api/v1/users/${row.id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    if (res.error) setErr(res.error.message);
    else void load();
  }

  async function setActive(row: UserRow, active: boolean) {
    const path = active ? 'reactivate' : 'deactivate';
    const res = await apiFetch(`/api/v1/users/${row.id}/${path}`, { method: 'POST' });
    if (res.error) setErr(res.error.message);
    else void load();
  }

  return (
    <>
      <h1>Users</h1>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}

      <section style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: 6 }}>
        <h2 style={{ marginTop: 0 }}>Invite user</h2>
        <form onSubmit={(e) => void submitInvite(e)} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <label>
            Email
            <input
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              style={input}
            />
          </label>
          <label>
            Name (optional)
            <input
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              style={input}
            />
          </label>
          <label>
            Role
            <select
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}
              style={input}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={{ padding: '0.5rem 1rem' }}>Send invite</button>
          </div>
        </form>
        {lastReset && (
          <p style={{ marginTop: '1rem', padding: '0.6rem', background: '#fffbe6', border: '1px solid #f0c000', borderRadius: 4 }}>
            <strong>One-time reset token for {lastReset.email}:</strong>
            <code style={{ display: 'block', marginTop: '0.4rem', wordBreak: 'break-all' }}>{lastReset.resetToken}</code>
            <span style={{ fontSize: '0.85em', color: '#555' }}>
              Share with the user via a secure channel — they POST it to /api/v1/auth/reset-password with their chosen new password.
            </span>
          </p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Users</h2>
          <label style={{ fontSize: '0.9em' }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            /> include inactive
          </label>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Email</th><th style={th}>Name</th>
              <th style={th}>Role</th><th style={th}>Last login</th>
              <th style={th}>Status</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.6 }}>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.name ?? '—'}</td>
                <td style={td}>
                  <select
                    value={u.role}
                    onChange={(e) => void changeRole(u, e.target.value as Role)}
                    aria-label={`role for ${u.email}`}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={td}>{u.last_login_at ? u.last_login_at.slice(0, 10) : '—'}</td>
                <td style={td}>{u.active ? 'active' : 'inactive'}</td>
                <td style={td}>
                  {u.active
                    ? <button type="button" onClick={() => void setActive(u, false)}>Deactivate</button>
                    : <button type="button" onClick={() => void setActive(u, true)}>Reactivate</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={td}>No users.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.4rem 0.6rem' };
const td: React.CSSProperties = { padding: '0.3rem 0.6rem', borderBottom: '1px solid #eee' };
const input: React.CSSProperties = { display: 'block', width: '100%', padding: '0.35rem 0.5rem', marginTop: '0.25rem', boxSizing: 'border-box' };
