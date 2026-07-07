'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders assistant chat text as GFM markdown (tables, bold, headings, lists).
 * react-markdown does not render raw HTML, so model output can't inject scripts.
 */
export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h3 className="mt-2 text-base font-bold">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-2 text-base font-bold">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-2 text-sm font-bold">{children}</h4>,
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="marker:text-[var(--muted-foreground)]">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] underline">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-[var(--muted)]/60 px-1 py-0.5 font-mono text-[0.8em]">
              {children}
            </code>
          ),
          hr: () => <hr className="my-2 border-[var(--border)]" />,
          table: ({ children }) => (
            <div className="my-1 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[var(--muted)]/50">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-[var(--border)] px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--border)] px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
