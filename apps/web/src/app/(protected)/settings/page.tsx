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
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Theme */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>

      {/* Profile + Preferences */}
      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div>
            <label className="block text-sm font-medium">Email</label>
            <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium">Role</label>
            <p className="mt-1 text-sm text-muted-foreground capitalize">
              {user?.role}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Preferences</h2>
          <div>
            <label htmlFor="timezone" className="block text-sm font-medium">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm"
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

          <div className="flex items-center gap-2">
            <input
              id="weeklyDigest"
              type="checkbox"
              checked={weeklyDigest}
              onChange={(e) => setWeeklyDigest(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="weeklyDigest" className="text-sm">
              Enable weekly spending digest
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <div>
            <label htmlFor="haWebhookUrl" className="block text-sm font-medium">
              Home Assistant Webhook URL
            </label>
            <input
              id="haWebhookUrl"
              type="url"
              value={haWebhookUrl}
              onChange={(e) => setHaWebhookUrl(e.target.value)}
              placeholder="https://homeassistant.local/api/webhook/..."
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm"
            />
          </div>
        </section>

        {message && (
          <p
            className={`text-sm ${message.includes('Failed') ? 'text-destructive' : 'text-green-600'}`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium
                     text-primary-foreground shadow hover:bg-primary/90
                     disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Security */}
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">Security</h2>
        <a
          href="/change-password"
          className="inline-block text-sm text-primary hover:underline"
        >
          Change password
        </a>
        <div>
          <button
            onClick={() => logout()}
            className="rounded-lg border border-destructive px-4 py-2 text-sm
                       text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
