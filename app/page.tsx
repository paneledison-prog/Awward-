'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SearchPanel, type ExtractRequest } from '@/components/SearchPanel';
import { BrowserHarvest } from '@/components/BrowserHarvest';
import { ProgressPanel } from '@/components/ProgressPanel';
import { OverviewTab } from '@/components/OverviewTab';
import { SectionsTab } from '@/components/SectionsTab';
import { CodeTab } from '@/components/CodeTab';
import { PromptTab } from '@/components/PromptTab';
import { AssetsTab } from '@/components/AssetsTab';
import type { ExtractionResult, JobEvent } from '@/lib/types';
import { Icon } from '@/components/Icon';

type Tab = 'prompt' | 'overview' | 'sections' | 'code' | 'assets';

const TABS: { id: Tab; label: string }[] = [
  { id: 'prompt', label: 'Agent brief' },
  { id: 'overview', label: 'Design system' },
  { id: 'sections', label: 'Sections' },
  { id: 'code', label: 'Code' },
  { id: 'assets', label: 'Assets' },
];

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [tab, setTab] = useState<Tab>('prompt');
  const sourceRef = useRef<EventSource | null>(null);

  // A harvest run in the visitor's own browser posts to /api/import and opens
  // ?job=<id> here, so the result has to be loadable without having started it.
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) return;

    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        // The import is analysed server-side and usually lands within a second
        // or two, so poll briefly rather than opening a stream for it.
        for (let attempt = 0; attempt < 60 && !cancelled; attempt++) {
          const res = await fetch(`/api/extract/${jobId}`);
          const data = await res.json();
          if (!res.ok) {
            setError(data.error ?? 'That extraction could not be loaded.');
            break;
          }
          if (data.status === 'done') {
            setResult(data.result as ExtractionResult);
            setTab('prompt');
            break;
          }
          if (data.status === 'error') {
            setError(data.error ?? 'Extraction failed.');
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {
        setError('Could not load that extraction.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const extract = useCallback(async (request: ExtractRequest) => {
    sourceRef.current?.close();
    setBusy(true);
    setEvents([]);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? 'Could not start the extraction.');
        setBusy(false);
        return;
      }

      const source = new EventSource(`/api/extract/${data.jobId}/stream`);
      sourceRef.current = source;

      source.addEventListener('progress', (event) => {
        setEvents((current) => [...current, JSON.parse((event as MessageEvent).data) as JobEvent]);
      });

      source.addEventListener('end', async () => {
        source.close();
        // The stream only reports progress; the result itself is fetched once so
        // a large payload never has to be chunked through SSE frames.
        const finished = await fetch(`/api/extract/${data.jobId}`).then((r) => r.json());
        if (finished.status === 'done') {
          setResult(finished.result as ExtractionResult);
          setTab('prompt');
        } else {
          setError(finished.error ?? 'Extraction failed.');
        }
        setBusy(false);
      });

      source.onerror = () => {
        source.close();
        setError('Lost the progress stream. The extraction may still have finished — reload to check.');
        setBusy(false);
      };
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 pb-4 pt-16 text-center sm:pt-20">
        <p className="text-xs uppercase tracking-[0.18em] text-fg-faint">DesignDNA</p>

        <h1 className="font-display mt-5 text-4xl leading-tight text-fg sm:text-5xl">
          What design do you want to build?
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-fg-dim">
          Enter a site. It renders in a real browser at three viewports, measures every computed
          style, and hands back design tokens, React and HTML, and a brief you can paste straight
          into an AI coding agent.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="card card-dots p-6 sm:p-7">
          <SearchPanel busy={busy} onExtract={extract} />
        </div>

        <div className="mt-4">
          {/* Opened automatically when the failure is the one it solves —
              being told the fix exists is no use if it stays collapsed. */}
          <BrowserHarvest startOpen={/bot check/i.test(error)} />
        </div>

        <p className="mt-5 text-center text-sm text-fg-dim">
          Driving this from a coding agent?{' '}
          <Link href="/connect" className="text-accent hover:underline">
            Connect it over MCP
          </Link>
          .
        </p>
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        {events.length > 0 && !result ? <ProgressPanel events={events} error={error} /> : null}

        {error && events.length === 0 ? (
          <p className="mx-auto max-w-3xl rounded-xl border border-rose/25 bg-rose/5 px-4 py-3 text-sm text-rose">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-6">
            <header className="card card-dots flex flex-wrap items-start justify-between gap-5 p-6 sm:p-7">
              <div className="min-w-0">
                <h2 className="font-display truncate text-2xl text-fg">{result.page.title}</h2>
                <a
                  href={result.page.finalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-sm text-accent hover:underline"
                >
                  {result.page.finalUrl}
                </a>
                <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-xs text-fg-faint">
                  <div className="flex gap-1.5">
                    <dt>elements</dt>
                    <dd className="text-fg-dim">{result.stats.nodesAnalyzed}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>colors</dt>
                    <dd className="text-fg-dim">{result.stats.colorsFound}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>sections</dt>
                    <dd className="text-fg-dim">{result.stats.sectionsFound}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>components</dt>
                    <dd className="text-fg-dim">{result.stats.componentsDetected}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>took</dt>
                    <dd className="text-fg-dim">{(result.page.durationMs / 1000).toFixed(1)}s</dd>
                  </div>
                </dl>
              </div>

              <a
                href={`/api/extract/${result.id}/download`}
                className="btn-dark shrink-0"
              >
                <Icon name="download" size={17} />
                Download bundle (.zip)
              </a>
            </header>

            {result.page.warnings.length ? (
              <ul className="flex flex-col gap-1 rounded-xl border border-amber/25 bg-amber/5 px-4 py-3 text-xs text-amber">
                {result.page.warnings.map((warning, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Icon name="alert" size={14} className="mt-0.5" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <nav className="segment scroll-thin max-w-full self-start overflow-x-auto">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  aria-pressed={tab === entry.id}
                  className="shrink-0 whitespace-nowrap px-4 py-2 text-sm"
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            {tab === 'prompt' ? <PromptTab result={result} /> : null}
            {tab === 'overview' ? <OverviewTab result={result} /> : null}
            {tab === 'sections' ? <SectionsTab result={result} /> : null}
            {tab === 'code' ? <CodeTab files={result.files} /> : null}
            {tab === 'assets' ? <AssetsTab result={result} /> : null}
          </div>
        ) : null}

        {!result && events.length === 0 && !error ? (
          <div className="tray mx-auto max-w-3xl px-6 py-14 text-center">
            <p className="text-sm text-fg-dim">
              Nothing extracted yet. Enter a site above to begin.
            </p>
          </div>
        ) : null}
      </div>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-12 pt-4">
        <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-fg-faint">
          DesignDNA honors robots.txt and extracts one page per run. The design system it measures is
          yours to build on; the copy, imagery and logos belong to the source site — switch content
          mode to <span className="text-fg-dim">placeholder</span> to get the same structure
          with stand-in text.
        </p>
      </footer>
    </main>
  );
}
