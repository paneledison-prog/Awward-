'use client';

import { useState } from 'react';
import type { ExtractionResult } from '@/lib/types';
import { CopyButton } from './CopyButton';

/**
 * The primary deliverable. Copying it is the reason most people are here, so
 * the button is the loudest control on the page and the full text stays visible
 * beneath it rather than hidden behind a download.
 */
export function PromptTab({ result }: { result: ExtractionResult }) {
  const [compact, setCompact] = useState(false);
  const text = compact ? result.agentPromptCompact : result.agentPrompt;
  const words = text.split(/\s+/).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Paste this into your AI agent</h3>
            <p className="mt-1 text-xs text-fg-dim">
              Works with Claude Code, Cursor, v0, Lovable or any coding agent. It contains the full
              design system, every section, and the build instructions.
            </p>
          </div>
          <CopyButton
            text={text}
            label={`Copy ${compact ? 'compact' : 'full'} brief`}
            className="!border-accent !bg-accent !px-5 !py-2.5 !text-sm !font-semibold !text-ink hover:!bg-accent-dim"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 font-mono text-[11px] text-fg-faint">
          <span>{text.length.toLocaleString()} chars</span>
          <span>~{words.toLocaleString()} words</span>
          <span>≈{Math.ceil(text.length / 4).toLocaleString()} tokens</span>
          <div className="flex items-center gap-1">
            {[
              { value: false, label: 'Full' },
              { value: true, label: 'Compact' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setCompact(option.value)}
                className={`rounded border px-2 py-1 transition ${
                  compact === option.value
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-line text-fg-faint hover:border-line-bright'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <pre className="scroll-thin max-h-[68vh] overflow-auto rounded-lg border border-line bg-panel p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-dim">
        {text}
      </pre>
    </div>
  );
}
