'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ data: { registrationOpen: boolean } }>('/auth/registration-status')
      .then((res) => setRegistrationOpen(res.data.registrationOpen))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post<{
        data: { user: any; mustChangePassword: boolean };
      }>('/auth/login', { email, password });

      if (res.data.mustChangePassword) {
        router.push('/change-password');
      } else {
        router.push(redirect);
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      {/* Atmospheric glows */}
      <div className="pointer-events-none fixed right-0 top-0 h-[500px] w-[500px] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-[var(--secondary)]/4 blur-[100px]" />

      <div className="relative w-full max-w-sm space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-xl">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--primary)]">
              MoneyPulse
            </h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              Wealth Management
            </p>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-semibold">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-4 py-2.5 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-4 py-2.5 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {registrationOpen && (
          <p className="text-center text-sm text-[var(--muted-foreground)]">
            No account yet?{' '}
            <a
              href="/register"
              className="font-semibold text-[var(--primary)] hover:underline"
            >
              Create admin account
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-[var(--muted-foreground)]">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
