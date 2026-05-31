'use client';

import { useEffect } from 'react';

/** Registers the MoneyPulse service worker for app-shell caching. */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[SW] Registration failed:', err));
  }, []);

  return null;
}
