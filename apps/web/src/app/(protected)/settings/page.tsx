'use client';

import { useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function SettingsPage() {
  const { user, settings, refetchUser, logout } = useAuth();
  const [timezone, setTimezone] = useState(
    settings?.timezone ?? 'America/New_York',
  );
  const [weeklyDigest, setWeeklyDigest] = useState(
    settings?.weeklyDigestEnabled ?? false,
  );
  const [haWebhookUrl, setHaWebhookUrl] = useState(
    settings?.haWebhookUrl ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await api.patch('/users/settings', {
        timezone,
        weeklyDigestEnabled: weeklyDigest,
        haWebhookUrl: haWebhookUrl || null,
      });
      refetchUser();
      setMessage('Settings saved');
    } catch (err: any) {
      setMessage(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-[var(--muted-foreground)]">Manage your preferences and integrations</p>
      </div>

      {/* Theme */}
      <section className="space-y-3 rounded-2xl bg-[var(--surface-container-low)] p-6">
        <h2 className="text-lg font-bold">Appearance</h2>
        <ThemeToggle />
      </section>

      {/* Profile + Preferences */}
      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
          <h2 className="text-lg font-bold">Profile</h2>
          <div>
            <label className="block text-sm font-semibold">Email</label>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{user?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold">Role</label>
            <p className="mt-1 text-sm text-[var(--muted-foreground)] capitalize">
              {user?.role}
            </p>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
          <h2 className="text-lg font-bold">Preferences</h2>
          <div>
            <label htmlFor="timezone" className="block text-sm font-semibold">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            >
              {[
                'America/New_York',
                'America/Chicago',
                'America/Denver',
                'America/Los_Angeles',
                'America/Phoenix',
                'Pacific/Honolulu',
                'Europe/London',
                'Europe/Berlin',
                'Asia/Tokyo',
                'UTC',
              ].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="weeklyDigest"
              type="checkbox"
              checked={weeklyDigest}
              onChange={(e) => setWeeklyDigest(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            <label htmlFor="weeklyDigest" className="text-sm font-medium">
              Enable weekly spending digest
            </label>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
          <h2 className="text-lg font-bold">Integrations</h2>
          <div>
            <label htmlFor="haWebhookUrl" className="block text-sm font-semibold">
              Home Assistant Webhook URL
            </label>
            <input
              id="haWebhookUrl"
              type="url"
              value={haWebhookUrl}
              onChange={(e) => setHaWebhookUrl(e.target.value)}
              placeholder="https://homeassistant.local/api/webhook/..."
              className="mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
          </div>
        </section>

        {message && (
          <p
            className={`rounded-xl px-4 py-3 text-sm font-medium ${
              message.includes('Failed')
                ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]'
                : 'bg-[var(--secondary)]/10 text-[var(--secondary)]'
            }`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Security */}
      <section className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6">
        <h2 className="text-lg font-bold">Security</h2>
        <a
          href="/change-password"
          className="inline-block text-sm font-semibold text-[var(--primary)] hover:underline"
        >
          Change password
        </a>
        <div>
          <button
            onClick={() => logout()}
            className="rounded-full border border-[var(--destructive)] px-5 py-2.5 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
