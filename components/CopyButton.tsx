'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

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
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
        copied
          ? 'border-transparent bg-fg text-panel'
          : 'border-line bg-panel text-fg-dim hover:border-line-bright hover:text-fg'
      } ${className}`}
    >
      <Icon name={copied ? 'tick' : 'copy'} size={14} />
      {copied ? 'Copied' : label}
    </button>
  );
}
