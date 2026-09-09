'use client';

import { useState } from 'react';
import type { ContentMode, ViewportLabel } from '@/lib/types';

export interface SiteCandidate {
  url: string;
  title: string;
  description: string;
  favicon: string;
}

export interface ExtractRequest {
  url: string;
  contentMode: ContentMode;
  viewports: ViewportLabel[];
  emitReact: boolean;
  emitHtml: boolean;
}

const VIEWPORT_LABELS: Record<ViewportLabel, string> = {
  desktop: 'Desktop 1440',
  tablet: 'Tablet 768',
  mobile: 'Mobile 390',
};

export function SearchPanel({
  busy,
  onExtract,
}: {
  busy: boolean;
  onExtract: (request: ExtractRequest) => void;
}) {
  const [input, setInput] = useState('');
  const [contentMode, setContentMode] = useState<ContentMode>('verbatim');
  const [viewports, setViewports] = useState<ViewportLabel[]>(['desktop', 'tablet', 'mobile']);
  const [emitReact, setEmitReact] = useState(true);
  const [emitHtml, setEmitHtml] = useState(true);
  const [candidates, setCandidates] = useState<SiteCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');

  const start = (url: string) => {
    setCandidates([]);
    setError('');
    onExtract({ url, contentMode, viewports, emitReact, emitHtml });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || busy) return;

    setResolving(true);
    setError('');
    setCandidates([]);
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await response.json();

      if (data.direct) {
        start(data.direct);
      } else if (data.candidates?.length === 1) {
        // One match is not a choice; going straight to extraction saves a click.
        start(data.candidates[0].url);
      } else if (data.candidates?.length) {
        setCandidates(data.candidates);
      } else {
        setError(data.error ?? 'Could not resolve that name to a website.');
      }
    } catch {
      setError('Resolution failed. Check the URL and your connection.');
    } finally {
      setResolving(false);
    }
  };

  const toggleViewport = (label: ViewportLabel) => {
    setViewports((current) =>
      current.includes(label)
        ? current.filter((v) => v !== label)
        : [...current, label].sort(
            (a, b) =>
              (['desktop', 'tablet', 'mobile'] as ViewportLabel[]).indexOf(a) -
              (['desktop', 'tablet', 'mobile'] as ViewportLabel[]).indexOf(b),
          ),
    );
  };

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-sm text-fg-faint">
            →
          </span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="stripe.com, linear, or https://example.com/pricing"
            disabled={busy}
            className="w-full rounded-lg border border-line bg-panel py-3.5 pl-11 pr-4 font-mono text-sm text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={busy || resolving || !input.trim()}
          className="rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-ink transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Extracting…' : resolving ? 'Resolving…' : 'Extract design'}
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-rose/30 bg-rose/5 px-3 py-2 text-sm text-rose">
          {error}
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-panel p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-fg-faint">
            Several sites match — pick one
          </p>
          <div className="flex flex-col gap-1">
            {candidates.map((candidate) => (
              <button
                key={candidate.url}
                type="button"
                onClick={() => start(candidate.url)}
                className="flex items-start gap-3 rounded-md px-3 py-2 text-left transition hover:bg-panel-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={candidate.favicon} alt="" width={16} height={16} className="mt-1 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{candidate.title}</span>
                  <span className="block truncate font-mono text-xs text-fg-faint">{candidate.url}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-fg-faint">Viewports</span>
          {(Object.keys(VIEWPORT_LABELS) as ViewportLabel[]).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleViewport(label)}
              disabled={busy}
              className={`rounded border px-2 py-1 font-mono transition ${
                viewports.includes(label)
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-line text-fg-faint hover:border-line-bright'
              }`}
            >
              {VIEWPORT_LABELS[label]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-faint">Content</span>
          {(['verbatim', 'placeholder'] as ContentMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setContentMode(mode)}
              disabled={busy}
              className={`rounded border px-2 py-1 font-mono transition ${
                contentMode === mode
                  ? 'border-violet/50 bg-violet/10 text-violet'
                  : 'border-line text-fg-faint hover:border-line-bright'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-faint">Emit</span>
          {[
            { on: emitReact, set: setEmitReact, label: 'React + Tailwind' },
            { on: emitHtml, set: setEmitHtml, label: 'HTML + CSS' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => option.set(!option.on)}
              disabled={busy}
              className={`rounded border px-2 py-1 font-mono transition ${
                option.on
                  ? 'border-amber/50 bg-amber/10 text-amber'
                  : 'border-line text-fg-faint hover:border-line-bright'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
