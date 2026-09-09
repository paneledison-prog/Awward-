'use client';

import type { ExtractionResult } from '@/lib/types';

function Swatch({ hex, name, sub }: { hex: string; name: string; sub?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="h-16 w-full" style={{ background: hex }} />
      <div className="bg-panel-2 px-3 py-2">
        <div className="truncate text-xs font-medium text-fg">{name}</div>
        <div className="font-mono text-[11px] text-fg-faint">{hex}</div>
        {sub ? <div className="mt-0.5 truncate text-[11px] text-fg-faint">{sub}</div> : null}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-faint">{title}</h3>
      {children}
    </section>
  );
}

export function OverviewTab({ result }: { result: ExtractionResult }) {
  const { design } = result;
  const roles = Object.entries(design.palette.roles);
  const others = design.palette.tokens.filter((t) => t.roles[0] === 'neutral').slice(0, 12);

  return (
    <div className="flex flex-col gap-5">
      <Panel title={`Color roles · ${design.palette.isDark ? 'dark theme' : 'light theme'}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {roles.map(([role, hex]) => (
            <Swatch key={role} hex={hex!} name={role} />
          ))}
        </div>
        {others.length ? (
          <>
            <p className="mb-3 mt-6 text-xs text-fg-faint">Supporting colors, by rendered area</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {others.map((token) => (
                <Swatch key={token.hex} hex={token.hex} name={token.name} sub={token.properties[0]} />
              ))}
            </div>
          </>
        ) : null}
      </Panel>

      <Panel title="Type scale">
        <div className="flex flex-col divide-y divide-line">
          {design.typeScale.map((token) => (
            <div key={token.name} className="flex items-baseline gap-4 py-3">
              <code className="w-28 shrink-0 font-mono text-xs text-accent">{token.name}</code>
              <code className="w-40 shrink-0 font-mono text-[11px] text-fg-faint">
                {token.fontSize}px / {token.lineHeight} · {token.fontWeight}
              </code>
              <div
                className="min-w-0 flex-1 truncate text-fg"
                style={{
                  fontSize: `${Math.min(token.fontSize, 34)}px`,
                  fontWeight: token.fontWeight,
                  letterSpacing: token.letterSpacing === 'normal' ? undefined : token.letterSpacing,
                  lineHeight: 1.2,
                }}
              >
                {token.sample || 'The quick brown fox'}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`Spacing · ${design.spacing.baseUnit}px base (${Math.round(design.spacing.confidence * 100)}% fit)`}>
          <div className="flex flex-col gap-2">
            {design.spacing.values.map((value) => (
              <div key={value} className="flex items-center gap-3">
                <code className="w-12 shrink-0 font-mono text-xs text-fg-faint">{value}</code>
                <div
                  className="h-3 rounded-sm bg-accent/70"
                  style={{ width: `${Math.min(value * 2.5, 340)}px` }}
                />
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Radii & elevation">
            {design.radii.length === 0 && design.shadows.length === 0 ? (
              <p className="text-sm text-fg-faint">No repeated radii or shadows detected.</p>
            ) : (
              /*
               * Swatches sit on the extracted page's own background rather than
               * this dark UI. A light-theme shadow like rgba(15,23,42,.06) is
               * completely invisible against a dark panel, so previewing it here
               * would show an empty square and imply nothing was found.
               */
              <div
                className="flex flex-wrap gap-4 rounded-md p-4"
                style={{ background: design.palette.roles.background ?? '#ffffff' }}
              >
                {design.radii.map((radius) => (
                  <div key={radius.name} className="text-center">
                    <div
                      className="h-14 w-14"
                      style={{
                        borderRadius: radius.px > 100 ? '9999px' : radius.value,
                        background: design.palette.roles.surface ?? '#f1f5f9',
                        border: `1px solid ${design.palette.roles.border ?? '#e2e8f0'}`,
                      }}
                    />
                    <code
                      className="mt-1 block font-mono text-[11px]"
                      style={{ color: design.palette.roles.muted ?? '#64748b' }}
                    >
                      {radius.name}
                    </code>
                  </div>
                ))}
                {design.shadows.map((shadow) => (
                  <div key={shadow.name} className="text-center">
                    <div
                      className="h-14 w-14 rounded-lg"
                      style={{
                        boxShadow: shadow.value,
                        background: design.palette.roles.surface ?? '#ffffff',
                      }}
                    />
                    <code
                      className="mt-1 block font-mono text-[11px]"
                      style={{ color: design.palette.roles.muted ?? '#64748b' }}
                    >
                      shadow-{shadow.name}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Layout & motion">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-xs">
              <dt className="text-fg-faint">container</dt>
              <dd className="text-fg">
                {design.container.maxWidth ? `${design.container.maxWidth}px` : 'full bleed'}
              </dd>
              <dt className="text-fg-faint">breakpoints</dt>
              <dd className="text-fg">{design.breakpoints.join(' · ') || 'none declared'}</dd>
              <dt className="text-fg-faint">fonts</dt>
              <dd className="text-fg">
                {design.families.map((f) => `${f.primary} (${f.usage})`).join(', ') || '—'}
              </dd>
              <dt className="text-fg-faint">duration</dt>
              <dd className="text-fg">{design.motion.durations[0]?.value ?? '—'}</dd>
              <dt className="text-fg-faint">easing</dt>
              <dd className="truncate text-fg">{design.motion.easings[0]?.value ?? '—'}</dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
