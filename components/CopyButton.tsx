'use client';

import { useEffect, useState } from 'react';

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access is blocked outside a secure context; select the text
      // instead so the user can still copy it by hand.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      setCopied(true);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
        copied
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-line-bright bg-panel-2 text-fg-dim hover:border-accent/60 hover:text-fg'
      } ${className}`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
