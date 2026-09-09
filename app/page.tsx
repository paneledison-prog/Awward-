'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchPanel, type ExtractRequest } from '@/components/SearchPanel';
import { BrowserHarvest } from '@/components/BrowserHarvest';
import { ProgressPanel } from '@/components/ProgressPanel';
import { OverviewTab } from '@/components/OverviewTab';
import { SectionsTab } from '@/components/SectionsTab';
import { CodeTab } from '@/components/CodeTab';
import { PromptTab } from '@/components/PromptTab';
import { AssetsTab } from '@/components/AssetsTab';
import type { ExtractionResult, JobEvent } from '@/lib/types';

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
      <div className="grid-backdrop border-b border-line">
        <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-14">
          {/* Stacks on phones: the tagline wraps into a ragged block beside
              a 2xl heading otherwise. */}
          <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">DesignDNA</h1>
            <p className="font-mono text-xs text-fg-faint">
              measure any page&rsquo;s design system → get build-ready code
            </p>
          </div>

          {/* Clamped on phones so the input is reachable without scrolling. */}
          <p className="mb-6 line-clamp-3 max-w-2xl text-sm leading-relaxed text-fg-dim sm:line-clamp-none">
            Enter a site. It renders in a real browser at three viewports, measures every computed
            style, and infers the design system — colors, type scale, spacing grid, radii, shadows,
            motion, breakpoints — then segments the page into sections and detects repeating
            components. You get design tokens, React and HTML output, and a brief you can paste
            straight into an AI coding agent.
          </p>

          <SearchPanel busy={busy} onExtract={extract} />

          <div className="mt-5">
            <BrowserHarvest />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {events.length > 0 && !result ? <ProgressPanel events={events} error={error} /> : null}

        {error && events.length === 0 ? (
          <p className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-panel p-5">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium text-fg">{result.page.title}</h2>
                <a
                  href={result.page.finalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-xs text-accent hover:underline"
                >
                  {result.page.finalUrl}
                </a>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-fg-faint">
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
                className="shrink-0 rounded-lg border border-line-bright bg-panel-2 px-4 py-2.5 text-sm font-medium text-fg transition hover:border-accent/60"
              >
                ↓ Download bundle (.zip)
              </a>
            </header>

            {result.page.warnings.length ? (
              <ul className="flex flex-col gap-1 rounded-lg border border-amber/30 bg-amber/5 px-4 py-3 text-xs text-amber">
                {result.page.warnings.map((warning, index) => (
                  <li key={index}>· {warning}</li>
                ))}
              </ul>
            ) : null}

            <nav className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${
                    tab === entry.id
                      ? 'border-accent text-fg'
                      : 'border-transparent text-fg-faint hover:text-fg-dim'
                  }`}
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
          <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm text-fg-faint">
              Nothing extracted yet. Enter a site above to begin.
            </p>
          </div>
        ) : null}
      </div>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-12 pt-4">
        <p className="text-xs leading-relaxed text-fg-faint">
          DesignDNA honors robots.txt and extracts one page per run. The design system it measures is
          yours to build on; the copy, imagery and logos belong to the source site — switch content
          mode to <span className="font-mono text-fg-dim">placeholder</span> to get the same structure
          with stand-in text.
        </p>
      </footer>
    </main>
  );
}
