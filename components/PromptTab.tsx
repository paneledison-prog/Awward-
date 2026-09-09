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
      <div className="card card-dots p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-xl text-fg">Paste this into your AI agent</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-fg-dim">
              Works with Claude Code, Cursor, v0, Lovable or any coding agent. It contains the full
              design system, every section, and the build instructions.
            </p>
          </div>
          <CopyButton
            text={text}
            label={`Copy ${compact ? 'compact' : 'full'} brief`}
            className="btn-dark !border-0 !text-sm"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-line pt-4 text-xs text-fg-faint">
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
                className={`rounded-full border px-3 py-1 transition ${
                  compact === option.value
                    ? 'border-transparent bg-fg text-panel'
                    : 'border-line text-fg-dim hover:border-line-bright'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <pre className="scroll-thin max-h-[68vh] overflow-auto rounded-xl border border-line bg-panel-2 p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-dim">
        {text}
      </pre>
    </div>
  );
}
