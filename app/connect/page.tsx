'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';
import { Icon } from '@/components/Icon';

const TOOLS: { name: string; does: string }[] = [
  { name: 'find_site', does: 'Resolve a name like "stripe" to candidate URLs.' },
  { name: 'extract_page', does: 'Render a page at up to three viewports and measure all of it.' },
  { name: 'extract_component', does: 'Measure only the element matching a CSS selector.' },
  { name: 'get_extraction', does: 'Progress while it runs, the summary once it lands.' },
  { name: 'list_components', does: 'Every section and repeating group, with an id.' },
  { name: 'get_component', does: 'One component as React, HTML, tokens, or its own brief.' },
  { name: 'get_brief', does: 'The full build specification as markdown.' },
  { name: 'get_screenshot', does: 'The full-page render, as an image.' },
  { name: 'get_bundle', does: 'Every emitted file, and a link to the ZIP.' },
  { name: 'request_browser_capture', does: 'Ask your browser for a page the renderer cannot reach.' },
  { name: 'list_capture_requests', does: 'What you queued, and what became of it.' },
];

export default function Connect() {
  // The instance's own URL is the one thing this page cannot hardcode.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const endpoint = `${origin || 'https://your-instance'}/api/mcp`;
  const cli = `claude mcp add --transport http designdna ${endpoint}`;
  const json = JSON.stringify(
    { mcpServers: { designdna: { type: 'http', url: endpoint } } },
    null,
    2,
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-14">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-fg-dim hover:text-fg">
          <Icon name="arrowRight" size={15} className="rotate-180" />
          DesignDNA
        </Link>

        <h1 className="font-display mt-8 text-4xl leading-tight text-fg">Connect your agent</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-fg-dim">
          This instance speaks MCP. Point Claude Code, Cursor, or anything else that speaks it at
          the endpoint below and your agent can extract a page, pull a single component out of it,
          and read the brief — without you in the loop.
        </p>

        <section className="card card-dots mt-8 p-6 sm:p-7">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Endpoint</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-panel-2 px-4 py-3 font-mono text-sm text-fg">
              {endpoint}
            </code>
            <CopyButton text={endpoint} label="Copy" />
          </div>

          <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-fg-faint">
            Claude Code
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-panel-2 px-4 py-3 font-mono text-sm text-fg">
              {cli}
            </code>
            <CopyButton text={cli} label="Copy" />
          </div>

          <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-fg-faint">
            Cursor, Windsurf, anything with a config file
          </h3>
          <pre className="scroll-thin mt-3 overflow-auto rounded-xl border border-line bg-panel-2 p-4 font-mono text-xs leading-relaxed text-fg-dim">
            {json}
          </pre>
          <div className="mt-3">
            <CopyButton text={json} label="Copy config" />
          </div>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <h2 className="font-display text-2xl text-fg">What your agent can call</h2>
          <dl className="mt-5 divide-y divide-line">
            {TOOLS.map((tool) => (
              <div key={tool.name} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                <dt className="w-64 shrink-0 font-mono text-sm text-fg">{tool.name}</dt>
                <dd className="text-sm text-fg-dim">{tool.does}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <h2 className="font-display text-2xl text-fg">Try it</h2>
          <p className="mt-3 text-sm leading-relaxed text-fg-dim">
            Ask your agent, in its own words:
          </p>
          <blockquote className="mt-4 rounded-xl border border-line bg-panel-2 px-5 py-4 text-sm leading-relaxed text-fg">
            &ldquo;Extract stripe.com/pricing with DesignDNA, list the components, and rebuild the
            pricing table in our design system.&rdquo;
          </blockquote>
          <p className="mt-4 text-sm leading-relaxed text-fg-dim">
            It will call <span className="font-mono text-fg">extract_page</span>, then{' '}
            <span className="font-mono text-fg">list_components</span>, then{' '}
            <span className="font-mono text-fg">get_component</span> for the one it wants. If the
            site refuses the renderer, it will call{' '}
            <span className="font-mono text-fg">request_browser_capture</span> instead — and the
            request appears in your browser extension, where nothing happens until you click
            Capture.
          </p>
        </section>

        <section className="card mt-6 border-amber/30 bg-amber/5 p-6 sm:p-7">
          <h2 className="text-sm font-semibold text-amber">This endpoint is not authenticated</h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            Anyone who learns this URL can drive this instance&rsquo;s browser and queue capture
            requests into your extension. Two things bound that: <code className="font-mono">robots.txt</code>{' '}
            is enforced on every server-side render, and a queued capture is only ever displayed —
            it cannot run in your browser without your click. If that is not enough for where this
            is deployed, put it behind a private network or a proxy that requires a header.
          </p>
        </section>
      </div>
    </main>
  );
}
