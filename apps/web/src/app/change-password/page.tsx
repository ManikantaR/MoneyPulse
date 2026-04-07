'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 16) {
      setError('Password must be at least 16 characters');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      // All sessions revoked — redirect to login
      router.push('/login');
    } catch (err: any) {
      setError(err.message || 'Password change failed');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-4 py-2.5 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all';

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
              Change Password
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              You must change your password before continuing
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-semibold">
              Current / Temporary Password
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-semibold">
              New Password{' '}
              <span className="font-normal text-[var(--muted-foreground)]">
                (min 16 characters)
              </span>
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-semibold">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
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
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
