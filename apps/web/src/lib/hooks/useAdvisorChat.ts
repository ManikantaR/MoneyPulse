'use client';

import { useCallback, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streams the advisor answer over Server-Sent Events (POST /advisor/chat).
 * EventSource can't POST or send credentials, so we read the fetch body stream
 * and parse `data: {...}` frames ourselves.
 */
export function useAdvisorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || isStreaming) return;

      setError(null);
      // History = everything so far (before this turn).
      const history = messages;
      setMessages((m) => [
        ...m,
        { role: 'user', content: message },
        { role: 'assistant', content: '' },
      ]);
      setIsStreaming(true);

      const appendToAssistant = (delta: string) =>
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: 'assistant',
            content: next[next.length - 1].content + delta,
          };
          return next;
        });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/advisor/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Advisor request failed (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line.
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === 'delta') appendToAssistant(payload.text);
            else if (payload.type === 'error') setError(payload.text);
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Advisor error.');
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isStreaming, error, send, stop, reset };
}
