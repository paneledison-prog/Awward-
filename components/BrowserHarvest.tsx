'use client';

import { useState } from 'react';

/**
 * The escape hatch for sites that will not serve an automated browser.
 *
 * Shown by default rather than hidden behind an error, because the sites people
 * most want to extract are disproportionately the ones behind bot protection.
 */
export function BrowserHarvest({ startOpen = false }: { startOpen?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(startOpen);

  const copySnippet = async () => {
    setError('');
    try {
      const script = await fetch('/api/harvest-script').then((r) => r.text());
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy. Open /api/harvest-script and copy it manually.');
    }
  };

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
          startOpen ? 'bg-panel-2' : ''
        }`}
      >
        <span className="text-fg-faint">{open ? '−' : '+'}</span>
        <span className="text-sm text-fg-dim">
          Site blocked by a bot check? <span className="text-fg">Run it in your own browser.</span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-4">
          <p className="mb-4 max-w-2xl text-sm leading-relaxed text-fg-dim">
            Some sites refuse automated browsers and serve a &ldquo;verify you are
            human&rdquo; page instead. Nothing here can change that — but you can already
            view the site perfectly well. This runs the same measurement in the tab you
            already have open, and sends the result back.
          </p>

          <ol className="mb-4 flex flex-col gap-2 text-sm text-fg-dim">
            <li>
              <span className="mr-2 text-xs font-semibold text-fg-faint">1</span>
              Open the page you want in a normal tab.
            </li>
            <li>
              <span className="mr-2 text-xs font-semibold text-fg-faint">2</span>
              Open DevTools → Console (<code className="font-mono text-xs text-fg">F12</code>, or{' '}
              <code className="font-mono text-xs text-fg">⌥⌘J</code> on a Mac).
            </li>
            <li>
              <span className="mr-2 text-xs font-semibold text-fg-faint">3</span>
              Type <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs text-amber">allow pasting</code>{' '}
              and press Enter. Chrome blocks pasting into the console until you do — once per
              browser profile.
            </li>
            <li>
              <span className="mr-2 text-xs font-semibold text-fg-faint">4</span>
              Paste the snippet and press Enter. Results open in a new tab.
            </li>
          </ol>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copySnippet}
              className={`btn-dark ${copied ? 'opacity-70' : ''}`}
            >
              {copied ? '✓ Copied — now type "allow pasting" first' : 'Copy console snippet'}
            </button>
            <a
              href="/api/harvest-script"
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-fg-faint underline hover:text-fg-dim"
            >
              view the script
            </a>
          </div>

          {/* The extension needs none of the above, so it is offered as an
              equal alternative rather than a footnote. */}
          <div className="mt-6 rounded-md border border-line bg-panel-2 p-4">
            <p className="mb-1 text-sm font-medium text-fg">
              Skip the console entirely
            </p>
            <p className="mb-3 max-w-2xl text-xs leading-relaxed text-fg-dim">
              The browser extension does the same thing in one click — no DevTools, no
              &ldquo;allow pasting&rdquo;, and it captures a screenshot too. It also works on
              sites whose content-security policy would block a pasted script.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/api/extension"
                className="rounded-md border border-line-bright px-4 py-2 text-sm font-medium text-fg transition hover:border-accent/60"
              >
                ↓ Download extension (.zip)
              </a>
              <span className="font-mono text-[11px] text-fg-faint">
                unzip → chrome://extensions → Developer mode → Load unpacked
              </span>
            </div>
          </div>

          {error ? <p className="mt-3 text-xs text-rose">{error}</p> : null}

          <p className="mt-4 max-w-2xl text-xs leading-relaxed text-fg-faint">
            Chrome&rsquo;s paste warning is worth taking seriously in general — it exists because
            people get talked into pasting code that steals their session. Read this snippet
            before you run it; that is what the link above is for. Only the viewport you have
            open is measured, and no screenshot is taken — the extension does both and needs
            none of this.
          </p>
        </div>
      ) : null}
    </div>
  );
}
