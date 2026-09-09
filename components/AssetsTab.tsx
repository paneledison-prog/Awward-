'use client';

import type { ExtractionResult } from '@/lib/types';
import { CopyButton } from './CopyButton';

export function AssetsTab({ result }: { result: ExtractionResult }) {
  const { assets, design } = result;
  const brand = assets.images.filter((image) => image.isBrandAsset);

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-faint">
          Fonts
        </h3>
        {design.families.length === 0 ? (
          <p className="text-sm text-fg-faint">No families detected.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {design.families.map((family) => (
              <div key={family.stack} className="rounded-md border border-line bg-panel-2 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-fg">{family.primary}</span>
                  <span className="rounded border border-line-bright px-1.5 py-0.5 font-mono text-[11px] text-fg-dim">
                    {family.usage}
                  </span>
                  <span className="font-mono text-[11px] text-fg-faint">source: {family.source}</span>
                  <span className="font-mono text-[11px] text-fg-faint">
                    weights {family.weights.join(', ') || '—'}
                  </span>
                  <CopyButton text={family.importCode} label="Copy import" className="ml-auto" />
                </div>
                <pre className="scroll-thin overflow-x-auto font-mono text-[11px] text-fg-dim">
                  {family.importCode}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-faint">Icons</h3>
        {assets.icons.count === 0 ? (
          <p className="text-sm text-fg-faint">No inline SVG icons detected.</p>
        ) : (
          <p className="text-sm text-fg-dim">
            <span className="font-mono text-accent">{assets.icons.count}</span> inline SVG icons ·
            best match{' '}
            <span className="font-mono text-accent">{assets.icons.library}</span> (confidence{' '}
            {assets.icons.confidence}). Use that icon set rather than copying path data.
          </p>
        )}
      </section>

      {brand.length ? (
        <section className="rounded-lg border border-amber/30 bg-amber/5 p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber">
            {brand.length} brand asset{brand.length === 1 ? '' : 's'}
          </h3>
          <p className="text-sm text-fg-dim">
            These are the source site&rsquo;s logos and wordmarks. Replace them with your own before
            using this design.
          </p>
        </section>
      ) : null}

      <section className="card p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-faint">
          Images ({assets.images.length})
        </h3>
        <div className="scroll-thin max-h-[50vh] overflow-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-fg-faint">
              <tr className="border-b border-line">
                <th className="pb-2 pr-4 font-normal">Role</th>
                <th className="pb-2 pr-4 font-normal">Size</th>
                <th className="pb-2 pr-4 font-normal">Alt</th>
                <th className="pb-2 font-normal">Source</th>
              </tr>
            </thead>
            <tbody className="text-fg-dim">
              {assets.images.map((image, index) => (
                <tr key={`${image.src}-${index}`} className="border-b border-line/50">
                  <td className="py-2 pr-4">
                    <span className={image.isBrandAsset ? 'text-amber' : 'text-fg-dim'}>
                      {image.role}
                      {image.isBrandAsset ? ' ⚠' : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {image.width}×{image.height}
                  </td>
                  <td className="max-w-[220px] truncate py-2 pr-4">{image.alt || '—'}</td>
                  <td className="max-w-[320px] truncate py-2 text-fg-faint">
                    {image.src.startsWith('data:') ? '(inline data URI)' : image.src}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-faint">
          Screenshots
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(assets.screenshots).map(([viewport, path]) =>
            path ? (
              <figure key={viewport}>
                <div className="scroll-thin max-h-64 overflow-y-auto rounded border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={path} alt={`${viewport} render`} className="w-full" />
                </div>
                <figcaption className="mt-2 font-mono text-[11px] text-fg-faint">{viewport}</figcaption>
              </figure>
            ) : null,
          )}
        </div>
      </section>
    </div>
  );
}
