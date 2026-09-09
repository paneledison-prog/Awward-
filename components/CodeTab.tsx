'use client';

import { useState } from 'react';
import type { EmittedFile } from '@/lib/types';
import { CopyButton } from './CopyButton';

const LANGUAGE_COLOR: Record<string, string> = {
  json: 'text-amber',
  css: 'text-violet',
  tsx: 'text-accent',
  ts: 'text-accent',
  html: 'text-rose',
  markdown: 'text-fg-dim',
  javascript: 'text-amber',
};

export function CodeTab({ files }: { files: EmittedFile[] }) {
  const [selected, setSelected] = useState(files[0]?.path ?? '');
  const file = files.find((f) => f.path === selected) ?? files[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
      {/*
        min-w-0 is load-bearing: a grid item defaults to min-width:auto, so the
        longest file description sets the column's floor and pushes the whole
        page wider than a phone screen. truncate cannot shrink past that floor
        without it.
      */}
      <nav className="min-w-0 rounded-lg border border-line bg-panel p-2">
        <ul className="flex flex-col">
          {files.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                onClick={() => setSelected(entry.path)}
                className={`w-full rounded px-3 py-2 text-left transition ${
                  entry.path === file?.path ? 'bg-panel-2' : 'hover:bg-panel-2/60'
                }`}
              >
                <span
                  className={`block truncate font-mono text-xs ${
                    entry.path === file?.path ? 'text-fg' : 'text-fg-dim'
                  }`}
                >
                  {entry.path}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
                  {entry.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {file ? (
        <div className="min-w-0 rounded-lg border border-line bg-panel">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <code className="truncate font-mono text-xs text-fg">{file.path}</code>
              <span className={`shrink-0 font-mono text-[11px] ${LANGUAGE_COLOR[file.language]}`}>
                {file.language}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                {file.contents.split('\n').length} lines
              </span>
            </div>
            <CopyButton text={file.contents} />
          </header>
          <pre className="scroll-thin max-h-[64vh] overflow-auto p-4 font-mono text-xs leading-relaxed text-fg-dim">
            <code>{file.contents}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}
