// TASK-031 — /forgot-password screen (§6.13 AC-1).
//
// Always shows a generic success message regardless of whether the email
// exists — mirrors the API's no-enumeration contract.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../auth/api.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 360, margin: '0 auto' }}>
      <h1>Reset password</h1>
      {sent ? (
        <p>
          If an account exists for <strong>{email}</strong>, we sent a reset link. Check
          your inbox.
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </label>
          <button type="submit" disabled={submitting} style={{ padding: '0.6rem 1rem' }}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p style={{ marginTop: '1.5rem' }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
