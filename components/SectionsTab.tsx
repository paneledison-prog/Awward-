'use client';

import { useState } from 'react';
import type { ExtractionResult, SectionSpec } from '@/lib/types';
import { Icon } from './Icon';

const KIND_COLOR: Record<string, string> = {
  nav: 'text-fg-dim',
  hero: 'text-accent',
  'feature-grid': 'text-violet',
  'logo-cloud': 'text-fg-dim',
  testimonial: 'text-amber',
  pricing: 'text-violet',
  faq: 'text-fg-dim',
  stats: 'text-amber',
  gallery: 'text-fg-dim',
  cta: 'text-accent',
  content: 'text-fg-dim',
  footer: 'text-fg-faint',
};

function SectionCard({ section }: { section: SectionSpec }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      {/*
        Wraps to two rows on a phone: index, kind and metrics stay on the first
        line and the heading takes the second. Laid out as one row of fixed
        columns it needs ~560px, which pushes the whole page sideways.
      */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left sm:flex-nowrap sm:gap-4"
      >
        <span className="w-5 shrink-0 font-mono text-xs text-fg-faint sm:w-6">
          {section.order + 1}
        </span>
        <span
          className={`w-24 shrink-0 font-mono text-xs sm:w-28 ${KIND_COLOR[section.kind] ?? 'text-fg-dim'}`}
        >
          {section.kind}
        </span>
        <span className="order-last w-full min-w-0 truncate text-sm text-fg sm:order-none sm:w-auto sm:flex-1">
          {section.heading || section.label}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-faint sm:ml-0">
          {section.box[3]}px
          {section.layout.columns > 1 ? ` · ${section.layout.columns} cols` : ''}
          {section.repeat ? ` · ${section.repeat.count}×` : ''}
        </span>
        <span className="shrink-0 text-fg-faint">
          <Icon name={open ? 'minus' : 'plus'} size={16} />
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-4 text-sm">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
            <dt className="text-fg-faint">display</dt>
            <dd className="text-fg">
              {section.layout.display}
              {section.layout.gridTemplateColumns !== 'none'
                ? ` · ${section.layout.gridTemplateColumns}`
                : ''}
            </dd>
            <dt className="text-fg-faint">padding</dt>
            <dd className="text-fg">
              {section.layout.paddingTop}px / {section.layout.paddingBottom}px · {section.layout.paddingX}px sides
            </dd>
            <dt className="text-fg-faint">max-width</dt>
            <dd className="text-fg">{section.layout.maxWidth ? `${section.layout.maxWidth}px` : '—'}</dd>
            <dt className="text-fg-faint">background</dt>
            <dd className="text-fg">{section.background}</dd>
            {Object.keys(section.responsive).length > 1 ? (
              <>
                <dt className="text-fg-faint">responsive</dt>
                <dd className="text-fg">
                  {Object.entries(section.responsive)
                    .map(([vp, r]) => `${vp}: ${r.visible ? `${r.columns} col` : 'hidden'}`)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
          </dl>

          {section.eyebrow ? (
            <p className="mb-1 text-xs uppercase tracking-wider text-violet">{section.eyebrow}</p>
          ) : null}
          {section.heading ? <p className="mb-1 font-medium text-fg">{section.heading}</p> : null}
          {section.subheading ? <p className="mb-3 text-fg-dim">{section.subheading}</p> : null}

          {section.ctas.length ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {section.ctas.map((cta, i) => (
                <span
                  key={`${cta.label}-${i}`}
                  className="rounded border border-line-bright px-2 py-1 font-mono text-[11px] text-fg-dim"
                >
                  {cta.variant}: {cta.label}
                </span>
              ))}
            </div>
          ) : null}

          {section.repeat ? (
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <p className="mb-2 font-mono text-xs text-accent">
                {section.repeat.count}× &lt;{section.repeat.componentName} /&gt; in{' '}
                {section.repeat.columns} column(s)
              </p>
              <ul className="flex flex-col gap-1 text-xs text-fg-dim">
                {section.repeat.items.slice(0, 6).map((item, i) => (
                  <li key={i} className="truncate">
                    <span className="text-fg">{item.heading || `Item ${i + 1}`}</span>
                    {item.body ? ` — ${item.body}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {section.notes.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-fg-faint">
              {section.notes.map((note, i) => (
                <li key={i}>· {note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SectionsTab({ result }: { result: ExtractionResult }) {
  const shot = result.assets.screenshots.desktop;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-2">
        {result.sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>

      {shot ? (
        <div className="hidden lg:block">
          <div className="sticky top-6 card p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-fg-faint">Desktop render</p>
            <div className="max-h-[70vh] overflow-y-auto rounded scroll-thin">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt="Full-page render of the extracted site" className="w-full" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
