// TASK-031 — /login screen (§6.13 AC-1).
//
// Split layout: sign-in form on the left, brand panel on the right. The API
// deliberately returns a single generic "invalid credentials" message to
// avoid account enumeration.

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChefHat, AlertCircle, Mail, Lock } from 'lucide-react';
import { login } from '../auth/api.js';
import { Button } from '../components/ui/Button.js';
import { Field, Input } from '../components/ui/Input.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle grid grid-cols-1 lg:grid-cols-2">
      {/* Form side */}
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-md bg-brand-600 flex items-center justify-center shadow-sm">
              <ChefHat className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">TP Manager</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Restaurant Ops</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to manage recipes, prep, inventory, and forecasts.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Field label="Email" required>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@restaurant.com"
                  className="pl-9"
                />
              </div>
            </Field>

            <Field
              label={
                <span className="flex w-full items-center justify-between">
                  <span>Password</span>
                  <Link to="/forgot-password" className="text-xs font-medium">
                    Forgot?
                  </Link>
                </span>
              }
              required
            >
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                />
              </div>
            </Field>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" loading={submitting} size="lg" className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-xs text-slate-400 text-center">
            Protected by device-bound sessions. Contact your admin for access.
          </p>
        </div>
      </div>

      {/* Brand panel */}
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4) 0px, transparent 40%), ' +
            'radial-gradient(circle at 80% 70%, rgba(255,255,255,0.25) 0px, transparent 40%)',
        }} />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          <div className="flex items-center gap-2">
            <ChefHat className="h-6 w-6" />
            <span className="text-sm font-medium opacity-90">Built for restaurant operators</span>
          </div>

          <div className="max-w-md">
            <blockquote className="text-2xl font-semibold leading-snug">
              "From Monday prep sheets to end-of-week waste reports — everything the kitchen
              needs, in one place."
            </blockquote>
            <div className="mt-6 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center font-semibold">
                TP
              </div>
              <div>
                <div className="text-sm font-medium">TP Manager v1.6</div>
                <div className="text-xs opacity-75">Recipes · Forecasts · Inventory · Waste</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <Feature title="33" hint="entities modeled" />
            <Feature title="21" hint="operational modules" />
            <Feature title="p10–p90" hint="forecast bands" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 p-3">
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-xs opacity-80">{hint}</div>
    </div>
  );
}
