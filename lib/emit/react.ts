import type { ContentMode, DesignSystem, EmittedFile, SectionSpec } from '../types';
import { applyMode } from './content';

/** Text becomes a JSX expression so quotes, braces and entities all survive. */
function jsx(text: string): string {
  return `{'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'}`;
}

function attr(text: string): string {
  return `"${text.replace(/"/g, '&quot;')}"`;
}

/** Type tokens like `text-20` already carry the prefix Tailwind will add. */
export function stripTextPrefix(name: string): string {
  return name.startsWith('text-') ? name.slice(5) : name;
}

function pascal(input: string): string {
  return input
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join('') || 'Section';
}

/**
 * Emit Tailwind classes that reference the generated theme by name, falling
 * back to an arbitrary value only when the measurement is not part of the
 * extracted scale. A rebuild wired to token names stays editable; one full of
 * `bg-[#4f46e5]` is a pile of magic numbers.
 */
class ClassBuilder {
  private readonly colorNames = new Map<string, string>();

  constructor(private readonly design: DesignSystem) {
    for (const [role, hex] of Object.entries(design.palette.roles)) {
      if (hex && !this.colorNames.has(hex)) this.colorNames.set(hex, role);
    }
    for (const token of design.palette.tokens) {
      if (!this.colorNames.has(token.hex)) this.colorNames.set(token.hex, token.name);
    }
  }

  color(prefix: string, value: string): string | null {
    if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') return null;
    const hex = this.toHex(value);
    const name = hex ? this.colorNames.get(hex) : undefined;
    return name ? `${prefix}-${name}` : `${prefix}-[${value.replace(/\s+/g, '')}]`;
  }

  /**
   * Spacing uses Tailwind's own 0.25rem scale wherever the measurement lands on
   * it, and an explicit pixel value otherwise.
   *
   * Emitting `pt-96` for 96px would be a trap: in stock Tailwind that is 384px,
   * and it only means 96px if the generated config is also installed. Both
   * forms here mean the same thing in any project.
   */
  space(prefix: string, px: number): string | null {
    if (!px) return null;
    if (px % 4 === 0 && px / 4 <= 96) return `${prefix}-${px / 4}`;
    return `${prefix}-[${px}px]`;
  }

  text(sizePx: number): string {
    const token = this.design.typeScale.find((t) => t.fontSize === sizePx);
    return token ? `text-${stripTextPrefix(token.name)}` : `text-[${sizePx}px]`;
  }

  /** Named breakpoint the layout switches at, as a portable arbitrary variant. */
  columnVariant(): string {
    const breakpoint = this.design.breakpoints.find((b) => b > 768);
    return breakpoint ? `min-[${breakpoint}px]:` : 'md:';
  }

  radius(value: string): string | null {
    if (!value || value === '0px') return null;
    const token = this.design.radii.find((r) => r.value === value);
    return token ? `rounded-${token.name}` : `rounded-[${value}]`;
  }

  shadow(value: string): string | null {
    if (!value || value === 'none') return null;
    const token = this.design.shadows.find((s) => s.value === value);
    return token ? `shadow-${token.name}` : 'shadow-md';
  }

  private toHex(value: string): string | null {
    const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return value.startsWith('#') ? value.toLowerCase() : null;
    return (
      '#' +
      [match[1], match[2], match[3]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
    );
  }
}

const cx = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' ');

/** Card padding, snapped to the spacing scale like every other measurement. */
function itemPadding(cb: ClassBuilder, padding: string): string | null {
  const px = parseFloat(padding.split(' ')[0]);
  return Number.isFinite(px) && px > 0 ? cb.space('p', Math.round(px)) : null;
}

function ctaClasses(cb: ClassBuilder, cta: SectionSpec['ctas'][number]): string {
  return cx(
    'inline-flex items-center justify-center font-semibold transition',
    cb.space('px', cta.paddingX),
    cb.space('py', cta.paddingY),
    cb.radius(cta.radius),
    cb.color('bg', cta.background),
    cb.color('text', cta.color),
    cta.variant === 'secondary' && 'border',
  );
}

function repeatComponent(
  section: SectionSpec,
  cb: ClassBuilder,
  mode: ContentMode,
): { name: string; code: string; usage: string } | null {
  const repeat = section.repeat;
  if (!repeat) return null;

  const name = repeat.componentName;
  const itemClasses = cx(
    cb.color('bg', repeat.itemLayout.background),
    cb.radius(repeat.itemLayout.radius),
    cb.shadow(repeat.itemLayout.shadow),
    repeat.itemLayout.border !== 'none' && 'border border-border',
    itemPadding(cb, repeat.itemLayout.padding),
  );

  const items = repeat.items.map((item) => {
    const fields = [
      `    heading: ${jsx(applyMode(item.heading, mode)).slice(1, -1)},`,
      item.body ? `    body: ${jsx(applyMode(item.body, mode)).slice(1, -1)},` : '',
      item.href ? `    href: ${attr(item.href)},` : '',
      item.image ? `    image: { src: ${attr(item.image.src)}, alt: ${attr(item.image.alt)} },` : '',
    ].filter(Boolean);
    return `  {\n${fields.join('\n')}\n  },`;
  });

  const code = [
    `export interface ${name}Props {`,
    '  heading: string;',
    '  body?: string;',
    '  href?: string;',
    '  image?: { src: string; alt: string };',
    '}',
    '',
    `export function ${name}({ heading, body, image }: ${name}Props) {`,
    '  return (',
    `    <div className="${itemClasses}">`,
    '      {image ? (',
    '        <img src={image.src} alt={image.alt} className="mb-4 h-auto w-full" />',
    '      ) : null}',
    `      <h3 className="${cx(cb.text(20), 'font-semibold')}">{heading}</h3>`,
    '      {body ? <p className="mt-2 text-muted">{body}</p> : null}',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  const usage = [`const items: ${name}Props[] = [`, ...items, '];'].join('\n');

  return { name, code, usage };
}

export function emitReactSections(
  design: DesignSystem,
  sections: SectionSpec[],
  mode: ContentMode,
): EmittedFile[] {
  const cb = new ClassBuilder(design);
  const files: EmittedFile[] = [];
  const usedNames = new Set<string>();

  const componentNames = sections.map((section) => {
    let name = pascal(section.kind);
    let suffix = 2;
    while (usedNames.has(name)) name = `${pascal(section.kind)}${suffix++}`;
    usedNames.add(name);
    return name;
  });

  sections.forEach((section, index) => {
    const name = componentNames[index];
    const repeat = repeatComponent(section, cb, mode);

    const sectionClasses = cx(
      'w-full',
      cb.space('pt', section.layout.paddingTop),
      cb.space('pb', section.layout.paddingBottom),
      cb.color('bg', section.background),
      cb.color('text', section.textColor),
    );

    const containerClasses = cx(
      'mx-auto w-full',
      section.layout.maxWidth ? `max-w-[${section.layout.maxWidth}px]` : null,
      cb.space('px', section.layout.paddingX || 24),
      section.layout.textAlign === 'center' && 'text-center',
    );

    const body: string[] = [];

    if (section.eyebrow) {
      body.push(
        `        <p className="${cx('font-semibold uppercase tracking-wide', cb.color('text', design.palette.roles.primary ?? ''))}">${jsx(applyMode(section.eyebrow, mode))}</p>`,
      );
    }
    if (section.heading) {
      const tag = `h${Math.min(Math.max(section.headingLevel || 2, 1), 6)}`;
      const token = design.typeScale.find(
        (t) => /^h[1-6]$|^display$/.test(t.name) && t.tags.includes(tag),
      );
      body.push(
        `        <${tag} className="${cx(token ? `text-${stripTextPrefix(token.name)}` : 'text-h2', 'font-bold')}">${jsx(applyMode(section.heading, mode))}</${tag}>`,
      );
    }
    if (section.subheading) {
      body.push(
        `        <p className="${cx('mt-4', cb.color('text', design.palette.roles.muted ?? ''))}">${jsx(applyMode(section.subheading, mode))}</p>`,
      );
    }

    if (section.navLinks.length) {
      body.push(
        '        <nav className="flex flex-wrap items-center gap-6">',
        '          {links.map((link) => (',
        '            <a key={link.href + link.label} href={link.href} className="text-muted transition hover:text-foreground">',
        '              {link.label}',
        '            </a>',
        '          ))}',
        '        </nav>',
      );
    }

    if (repeat) {
      // Mobile-first: one column by default, expanding at the breakpoint the
      // page itself declares rather than a guessed `md:`.
      const grid = cx(
        'grid grid-cols-1',
        section.repeat!.columns > 1
          ? `${cb.columnVariant()}grid-cols-${Math.min(section.repeat!.columns, 6)}`
          : null,
        cb.space('gap', section.repeat!.gap) ?? 'gap-6',
        'mt-12',
      );
      body.push(
        `        <div className="${grid}">`,
        `          {items.map((item) => (`,
        `            <${repeat.name} key={item.heading} {...item} />`,
        '          ))}',
        '        </div>',
      );
    }

    if (section.ctas.length && !repeat) {
      body.push(
        `        <div className="${cx('mt-8 flex flex-wrap gap-4', section.layout.textAlign === 'center' && 'justify-center')}">`,
        ...section.ctas.map(
          (cta) =>
            `          <a href=${attr(cta.href || '#')} className="${ctaClasses(cb, cta)}">${jsx(applyMode(cta.label, mode))}</a>`,
        ),
        '        </div>',
      );
    }

    const imports = repeat ? [`import { ${repeat.name}, type ${repeat.name}Props } from './${repeat.name}';`, ''] : [];
    const linkData = section.navLinks.length
      ? [
          'const links = [',
          ...section.navLinks
            .slice(0, 12)
            .map((l) => `  { label: ${attr(applyMode(l.label, mode))}, href: ${attr(l.href || '#')} },`),
          '];',
          '',
        ]
      : [];

    const contents = [
      ...imports,
      ...linkData,
      ...(repeat ? [repeat.usage, ''] : []),
      `export function ${name}() {`,
      '  return (',
      `    <section className="${sectionClasses}">`,
      `      <div className="${containerClasses}">`,
      ...body,
      '      </div>',
      '    </section>',
      '  );',
      '}',
      '',
    ].join('\n');

    files.push({
      path: `components/${name}.tsx`,
      contents,
      language: 'tsx',
      description: `${section.label} section (${section.kind}).`,
    });

    if (repeat) {
      files.push({
        path: `components/${repeat.name}.tsx`,
        contents: repeat.code + '\n',
        language: 'tsx',
        description: `Repeating item used by ${name}.`,
      });
    }
  });

  files.push({
    path: 'app/page.tsx',
    contents: [
      ...componentNames.map((name) => `import { ${name} } from '@/components/${name}';`),
      '',
      'export default function Page() {',
      '  return (',
      '    <main className="min-h-screen bg-background text-foreground">',
      ...componentNames.map((name) => `      <${name} />`),
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),
    language: 'tsx',
    description: 'Page composing every section in source order.',
  });

  return files;
}
