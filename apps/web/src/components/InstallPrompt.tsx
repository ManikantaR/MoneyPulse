'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Shows an "Install app" affordance when the browser fires beforeinstallprompt (Android/desktop).
 *  Falls back to an iOS instruction note on Safari. Mounted at root so the event is never missed. */
export function InstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Detect iOS Safari (no beforeinstallprompt support)
    const ios =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;
    const inStandalone = window.matchMedia('(display-mode: standalone)').matches;

    if (ios && !inStandalone) {
      setIsIos(true);
      setShowBanner(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || !showBanner) return null;

  if (isIos) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-[60] flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl md:left-auto md:right-6 md:max-w-sm">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">Install MoneyPulse</p>
          <p className="text-[var(--muted-foreground)]">
            Tap{' '}
            <span className="font-medium">Share</span> → <span className="font-medium">Add to Home Screen</span>
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[60] flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl md:left-auto md:right-6 md:max-w-sm">
      <Download className="h-5 w-5 shrink-0 text-[var(--primary)]" />
      <div className="flex-1 text-sm">
        <p className="font-semibold">Install MoneyPulse</p>
        <p className="text-[var(--muted-foreground)]">Add to your home screen</p>
      </div>
      <button
        onClick={async () => {
          if (!deferredPrompt.current) return;
          await deferredPrompt.current.prompt();
          const { outcome } = await deferredPrompt.current.userChoice;
          if (outcome === 'accepted') deferredPrompt.current = null;
          setDismissed(true);
        }}
        className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
      >
        Install
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
