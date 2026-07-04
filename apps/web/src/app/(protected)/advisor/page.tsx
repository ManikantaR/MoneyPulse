'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Square } from 'lucide-react';
import { useAdvisorChat } from '@/lib/hooks/useAdvisorChat';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const SUGGESTIONS = [
  'How much did I spend on dining last month?',
  'Am I over budget in any category?',
  'Which subscriptions recur every month?',
  'How did my spending change from last month?',
];

/** Ask-your-money advisor chat (Phase 1, #38). */
export default function AdvisorPage() {
  const { messages, isStreaming, error, send, stop } = useAdvisorChat();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<{ enabled: boolean; disclaimer: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/advisor/status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setStatus(j.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    if (!input.trim() || isStreaming) return;
    send(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-6 h-6 text-[var(--primary)]" />
        <h1 className="text-2xl font-bold">Advisor</h1>
      </div>

      {status && !status.enabled && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-3 text-sm text-[var(--muted-foreground)]">
          The advisor isn&apos;t configured yet. Set <code>ANTHROPIC_API_KEY</code> in the
          server environment to enable it.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="text-sm text-[var(--muted-foreground)]">
            <p className="mb-3">Ask about your own finances — grounded in your data.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={isStreaming}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--muted)]/50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--card)] border border-[var(--border)]'
              }`}
            >
              {m.content || (isStreaming && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about your finances…"
            disabled={status ? !status.enabled : false}
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              className="rounded-md bg-[var(--muted)] px-3 py-2"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              aria-label="Send"
              disabled={!input.trim() || (status ? !status.enabled : false)}
              className="rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] px-3 py-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
          {status?.disclaimer ??
            'Informational insights based on your own data — not personalized financial advice.'}
        </p>
      </div>
    </div>
  );
}
