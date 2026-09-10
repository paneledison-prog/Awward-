import type {
  AssetManifest,
  ContentMode,
  DesignSystem,
  EmittedFile,
  PageMeta,
  SectionSpec,
  ViewportLabel,
} from '../types';
import { VIEWPORTS } from '../viewports';
import { applyMode } from './content';

/** What the ZIP will contain. The brief lists it so an agent that was handed
 *  the archive knows what each file is before opening any of them. */
export type BundleFile = Pick<EmittedFile, 'path' | 'description'>;

/**
 * What this brief describes. A component brief is the same document with a
 * different subject — one section instead of eight, and a screenshot that shows
 * the page it was cut from rather than the thing being built.
 */
export interface BriefSubject {
  kind: 'page' | 'component';
  /** The selector that scoped the extraction. */
  selector?: string;
  /** Where the component sits in the page: [x, y, width, height]. */
  box?: [number, number, number, number];
}

const PAGE: BriefSubject = { kind: 'page' };

/** Pipes and newlines break markdown tables; nothing else needs escaping. */
const cell = (value: string | number | null | undefined): string =>
  String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim() || '—';

const table = (headers: string[], rows: (string | number | null | undefined)[][]): string => {
  if (rows.length === 0) return '_None detected._';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
};

/** An aligned file tree. One column width for every row, so the descriptions
 *  line up however long the longest path turns out to be. */
function tree(rows: [string, string][]): string[] {
  const width = Math.max(...rows.map(([path]) => path.length)) + 2;
  return rows.map(([path, description], index) => {
    const branch = index === rows.length - 1 ? '└──' : '├──';
    return `${branch} ${path.padEnd(width)}${description}`;
  });
}

/**
 * §0 — what the reader is holding.
 *
 * An agent handed a folder of generated files guesses at their relationship:
 * it will edit `index.html` and ignore the tokens, or treat the emitted React
 * as the deliverable rather than as a starting point. Naming every file, its
 * authority, and the order to read them costs a page and removes the guessing.
 */
function bundleSection(
  page: PageMeta,
  assets: AssetManifest,
  files: BundleFile[],
  mode: ContentMode,
  subject: BriefSubject,
): string {
  const shots = Object.entries(assets.screenshots) as [ViewportLabel, string][];

  const out: string[] = [
    '## 0. What you have been given',
    '',
    'This brief is one file in a **DesignDNA extraction bundle** — a ZIP produced by',
    subject.kind === 'component'
      ? `rendering ${page.finalUrl} in a real browser and measuring the element`
      : `rendering ${page.finalUrl} in a real browser and measuring it. If you were handed`,
    subject.kind === 'component'
      ? `\`${subject.selector}\` inside it. If you were handed the archive, unzip it first;`
      : 'the archive, unzip it first; every path below is relative to its root.',
    ...(subject.kind === 'component' ? ['every path below is relative to its root.'] : []),
    '',
    '```',
    'extraction.zip',
    ...tree([
      ['README.md', 'what the bundle is, in one page'],
      ['AGENT_PROMPT.md', '← you are reading this: the full specification'],
      ['AGENT_PROMPT.compact.md', 'the same brief, trimmed for small context windows'],
      ...files
        .filter((f) => !f.path.startsWith('AGENT_PROMPT'))
        .map((f) => [f.path, f.description] as [string, string]),
      [
        'screenshots/',
        shots.length
          ? `full-page renders — ${shots.map(([vp]) => `${vp}.jpg`).join(', ')}`
          : '(none captured for this run)',
      ],
    ]),
    '```',
    '',
    '### How these relate',
    '',
    '| File | What it is | How to treat it |',
    '| --- | --- | --- |',
    '| `AGENT_PROMPT.md` | Measurements taken from the rendered page — computed styles, geometry, text | **Authoritative.** When it disagrees with any generated file, this wins |',
    '| Token files | The same measurements as a drop-in theme | Install first; import everything else from them |',
    '| Component / HTML files | Code generated *from* these measurements | A starting point, not a deliverable — rewrite freely to fit the target stack |',
    '| `spec.json` | The entire extraction, machine-readable | Query it when you need a value this brief summarised |',
    '| `screenshots/` | What the page actually looked like | The visual check on your build |',
    '',
    '### Read it in this order',
    '',
    '1. **This brief, §1** — put the design system into your theme config before writing markup.',
    '2. **`screenshots/`** — look at them. The numbers describe the page; the screenshots show it.',
    '3. **This brief, §2 and §3** — section order, then each section in detail.',
    '4. **The generated component files** — only to see one way to express §3, then write your own.',
    '',
    mode === 'verbatim'
      ? 'Copy in this brief is reproduced verbatim from the source page. It belongs to that site — keep it while building, replace it before shipping.'
      : 'Copy in this brief is stand-in text matching the original word count and shape; replace it with your own.',
    '',
  ];

  return out.join('\n');
}


function designSystemSection(design: DesignSystem): string {
  const out: string[] = ['## 1. Design system', ''];

  out.push('### Colors', '');
  const roleRows = Object.entries(design.palette.roles).map(([role, hex]) => {
    const token = design.palette.tokens.find((t) => t.hex === hex);
    return [role, hex, token ? `L ${token.oklch.l} · C ${token.oklch.c} · H ${token.oklch.h}` : ''];
  });
  out.push(table(['Role', 'Hex', 'OKLCH'], roleRows));
  out.push('', `Page is **${design.palette.isDark ? 'dark' : 'light'}** themed.`, '');

  const extra = design.palette.tokens.filter((t) => t.roles[0] === 'neutral').slice(0, 10);
  if (extra.length) {
    out.push('Supporting colors (area-weighted, most used first):', '');
    out.push(table(['Token', 'Hex', 'Used on'], extra.map((t) => [t.name, t.hex, t.properties.join(', ')])));
    out.push('');
  }

  if (design.darkPalette) {
    out.push('### Dark mode', '');
    out.push('The site responds to `prefers-color-scheme: dark` with:', '');
    out.push(
      table(
        ['Role', 'Hex'],
        Object.entries(design.darkPalette.roles).map(([role, hex]) => [role, hex]),
      ),
    );
    out.push('');
  }

  out.push('### Typography', '');
  for (const family of design.families) {
    out.push(`**${family.primary}** — ${family.usage} face, source: ${family.source}`);
    out.push('', '```css', `font-family: ${family.stack};`, '```', '');
    if (family.source !== 'system' && family.importCode) {
      out.push('```', family.importCode, '```', '');
    }
  }

  out.push(
    table(
      ['Token', 'Size', 'Weight', 'Line height', 'Letter spacing', 'Family', 'Used on'],
      design.typeScale.map((t) => [
        t.name,
        `${t.fontSize}px`,
        t.fontWeight,
        t.lineHeight,
        t.letterSpacing,
        t.family,
        t.tags.join(', '),
      ]),
    ),
    '',
  );

  out.push('### Spacing', '');
  out.push(
    `Base unit **${design.spacing.baseUnit}px** (${Math.round(design.spacing.confidence * 100)}% of measured values are multiples of it).`,
    '',
    `Scale in use: ${design.spacing.values.map((v) => `\`${v}px\``).join(' · ') || '—'}`,
    '',
  );

  if (design.radii.length) {
    out.push('### Radii', '');
    out.push(table(['Token', 'Value'], design.radii.map((r) => [r.name, r.value])), '');
  }
  if (design.shadows.length) {
    out.push('### Shadows', '');
    out.push(table(['Token', 'Value'], design.shadows.map((s) => [s.name, s.value])), '');
  }
  if (design.borderWidths.length) {
    out.push(`**Border widths:** ${design.borderWidths.map((b) => `\`${b.value}\``).join(', ')}`, '');
  }

  if (design.motion.usesTransitions || design.motion.keyframes.length) {
    out.push('### Motion', '');
    if (design.motion.durations.length) {
      out.push(`Durations: ${design.motion.durations.map((d) => `\`${d.value}\``).join(', ')}`);
    }
    if (design.motion.easings.length) {
      out.push(`Easings: ${design.motion.easings.map((e) => `\`${e.value}\``).join(', ')}`);
    }
    if (design.motion.keyframes.length) {
      out.push(`Keyframe animations: ${design.motion.keyframes.map((k) => `\`${k}\``).join(', ')}`);
    }
    out.push('');
  }

  out.push('### Layout', '');
  out.push(
    `- Content container max-width: **${design.container.maxWidth ? `${design.container.maxWidth}px` : 'none (full bleed)'}**`,
  );
  const padding = Object.entries(design.container.paddingX)
    .map(([vp, px]) => `${vp} ${px}px`)
    .join(', ');
  if (padding) out.push(`- Horizontal padding: ${padding}`);
  out.push(
    `- Breakpoints: ${design.breakpoints.length ? design.breakpoints.map((b) => `\`${b}px\``).join(' · ') : 'none declared'}`,
    '',
  );

  return out.join('\n');
}

function sectionDetail(section: SectionSpec, index: number, mode: ContentMode): string {
  const out: string[] = [`### 3.${index + 1} ${section.label} — \`${section.id}\``, ''];

  const layout = section.layout;
  out.push('**Layout**', '');
  out.push(`- Display: \`${layout.display}\`${layout.columns > 1 ? ` · ${layout.columns} columns` : ''}`);
  if (layout.gridTemplateColumns && layout.gridTemplateColumns !== 'none') {
    out.push(`- Grid template: \`${layout.gridTemplateColumns}\``);
  }
  if (layout.gap) out.push(`- Gap: \`${layout.gap}px\``);
  out.push(`- Padding: \`${layout.paddingTop}px\` top, \`${layout.paddingBottom}px\` bottom, \`${layout.paddingX}px\` sides`);
  if (layout.maxWidth) out.push(`- Content max-width: \`${layout.maxWidth}px\``);
  if (layout.textAlign && layout.textAlign !== 'start') out.push(`- Text align: \`${layout.textAlign}\``);
  out.push(`- Background: \`${section.background}\`${section.backgroundImage ? ` + \`${section.backgroundImage}\`` : ''}`);
  out.push('');

  // Buttons get their own table below; a Content block holding only buttons
  // renders as a bare heading with nothing under it.
  const hasCopy =
    section.eyebrow || section.heading || section.subheading || section.bodyText.length;
  if (hasCopy) {
    out.push('**Content**', '');
    if (section.eyebrow) out.push(`- Eyebrow: "${applyMode(section.eyebrow, mode)}"`);
    if (section.heading) {
      out.push(`- Heading (h${section.headingLevel || 2}): "${applyMode(section.heading, mode)}"`);
    }
    if (section.subheading) out.push(`- Subheading: "${applyMode(section.subheading, mode)}"`);
    for (const line of section.bodyText.filter((l) => l !== section.subheading)) {
      out.push(`- Body: "${applyMode(line, mode)}"`);
    }
    out.push('');
  }

  if (section.ctas.length) {
    out.push('**Buttons**', '');
    out.push(
      table(
        ['Label', 'Variant', 'Background', 'Text', 'Radius', 'Padding'],
        section.ctas.map((c) => [
          applyMode(c.label, mode),
          c.variant,
          c.background,
          c.color,
          c.radius,
          `${c.paddingY}px ${c.paddingX}px`,
        ]),
      ),
      '',
    );
  }

  if (section.navLinks.length) {
    out.push(
      `**Links:** ${section.navLinks.map((l) => `[${applyMode(l.label, mode)}](${l.href || '#'})`).join(' · ')}`,
      '',
    );
  }

  if (section.repeat) {
    const repeat = section.repeat;
    out.push(
      `**Repeating component — \`<${repeat.componentName} />\`**`,
      '',
      `${repeat.count} instances laid out in ${repeat.columns} column(s), gap \`${repeat.gap}px\`.`,
      '',
      'Item styling:',
      '',
      `- Padding \`${repeat.itemLayout.padding}\``,
      `- Background \`${repeat.itemLayout.background}\``,
      `- Radius \`${repeat.itemLayout.radius}\``,
      `- Border \`${repeat.itemLayout.border}\``,
    );
    if (repeat.itemLayout.shadow) out.push(`- Shadow \`${repeat.itemLayout.shadow}\``);
    out.push('', 'Item data:', '');
    out.push(
      table(
        ['#', 'Heading', 'Body', 'Link', 'Media'],
        repeat.items.map((item, i) => [
          i + 1,
          applyMode(item.heading, mode),
          applyMode(item.body, mode),
          item.href,
          item.image ? `${item.image.role} ${item.image.width}×${item.image.height}` : item.hasIcon ? 'icon' : '',
        ]),
      ),
      '',
    );
  }

  const responsive = Object.entries(section.responsive);
  if (responsive.length > 1) {
    out.push('**Responsive**', '');
    out.push(
      table(
        ['Viewport', 'Columns', 'Display', 'Padding X', 'Visible'],
        responsive.map(([vp, r]) => [vp, r.columns, r.display, `${r.paddingX}px`, r.visible ? 'yes' : 'no']),
      ),
      '',
    );
  }

  if (section.images.length) {
    out.push(
      table(
        ['Image', 'Role', 'Size', 'Alt'],
        section.images.slice(0, 8).map((img) => [
          img.src.startsWith('data:') ? '(inline data URI)' : img.src,
          img.role + (img.isBrandAsset ? ' ⚠ brand' : ''),
          `${img.width}×${img.height}`,
          img.alt,
        ]),
      ),
      '',
    );
  }

  if (section.notes.length) {
    out.push('**Notes**', '', ...section.notes.map((n) => `- ${n}`), '');
  }

  return out.join('\n');
}

function assetsSection(assets: AssetManifest, documentHeight: number, subject: BriefSubject): string {
  const out: string[] = ['## 4. Assets', ''];

  const brand = assets.images.filter((i) => i.isBrandAsset);
  if (brand.length) {
    out.push(
      `> **${brand.length} brand asset(s)** — logos and wordmarks belonging to the source site. Replace these with your own before shipping.`,
      '',
    );
  }

  out.push('### Icons', '');
  out.push(
    assets.icons.count === 0
      ? '_No inline SVG icons detected._'
      : `${assets.icons.count} inline SVG icons. Best match: **${assets.icons.library}** (confidence ${assets.icons.confidence}). Use that set rather than copying path data.`,
    '',
  );
  if (assets.icons.samples.length) {
    out.push('```html', ...assets.icons.samples, '```', '');
  }

  out.push('### Images', '');
  out.push(
    table(
      ['Source', 'Role', 'Size', 'Alt'],
      assets.images
        .slice(0, 30)
        .map((i) => [
          i.src.startsWith('data:') ? '(inline data URI)' : i.src,
          i.role + (i.isBrandAsset ? ' ⚠' : ''),
          `${i.width}×${i.height}`,
          i.alt,
        ]),
    ),
    '',
  );

  out.push(screenshotsSection(assets, documentHeight, subject));

  return out.join('\n');
}

/**
 * The screenshots, described rather than listed.
 *
 * A bare list of paths gets ignored: an agent has no way to know these are
 * full-page renders at a known width, taken in the same pass as every number
 * in this brief, and therefore the one artifact that can settle a question the
 * measurements leave open — what the page actually looks like.
 */
function screenshotsSection(
  assets: AssetManifest,
  documentHeight: number,
  subject: BriefSubject,
): string {
  const shots = Object.entries(assets.screenshots) as [ViewportLabel, string][];

  if (!shots.length) {
    return [
      '### Reference screenshots',
      '',
      '_None captured for this run._ Build from the measurements alone, and say so in your',
      'summary rather than guessing at anything this brief does not state.',
      '',
    ].join('\n');
  }

  return [
    '### Reference screenshots',
    '',
    `In the bundle under \`screenshots/\`. Each is a **full-page** render — the entire`,
    `scroll height (${documentHeight}px at capture), not just the visible window — taken in`,
    'the same pass that produced every measurement above, with animations disabled and the',
    'text caret hidden so the image is stable.',
    '',
    table(
      ['File', 'Viewport width', 'What it shows'],
      shots.map(([vp, path]) => [
        `\`screenshots/${vp}.jpg\``,
        `${VIEWPORTS[vp]?.width ?? '—'}px`,
        vp === 'desktop'
          ? 'The layout §2 and §3 describe. Compare your build against this one first.'
          : `The same page reflowed at ${VIEWPORTS[vp]?.width ?? '—'}px — column counts and hidden elements at this size`,
      ]),
    ),
    '',
    ...(subject.kind === 'component' && subject.box
      ? [
          `**These show the whole page, not just the component.** It sits at x ${subject.box[0]}, `
            + `y ${subject.box[1]}, ${subject.box[2]}×${subject.box[3]}px — look there, and use the `
            + 'surroundings to judge how much space it is given.',
          '',
        ]
      : []),
    '**Use them for:**',
    '',
    '- Checking section order and vertical rhythm against §2 before you write any markup.',
    '- Resolving anything the numbers under-determine: relative emphasis, image treatment,',
    '  how much air sits around a heading, where a rule or divider actually falls.',
    '- Verifying your finished build at each width, side by side, rather than by reading',
    '  your own code back.',
    '',
    '**What they do not show:** hover, focus and active states; anything behind a tab,',
    'accordion or modal that was closed at capture; content that loads on scroll after the',
    'capture settled; and video or animation, which is frozen at a single frame.',
    '',
    'If you cannot open images, say so plainly and build from the measurements — do not',
    'describe a screenshot you have not seen.',
    '',
  ].join('\n');
}

function buildInstructions(
  design: DesignSystem,
  sections: SectionSpec[],
  mode: ContentMode,
  assets: AssetManifest,
  subject: BriefSubject,
): string {
  const shots = Object.keys(assets.screenshots) as ViewportLabel[];
  const components = sections.filter((s) => s.repeat).map((s) => s.repeat!.componentName);
  const bodyFont = design.families.find((f) => f.usage === 'body');
  const displayFont = design.families.find((f) => f.usage === 'display');

  return [
    '## 5. Build instructions',
    '',
    shots.length
      ? `0. Open \`screenshots/${shots[0]}.jpg\` and look at ${subject.kind === 'component' ? 'the element §4 locates in it' : 'the page'} before writing anything.`
      : '0. No screenshots were captured for this run; the measurements below are the only record of the page.',
    '1. Start from the design tokens. Put the color, type, spacing, radius and shadow values',
    '   into your theme configuration *before* writing any markup — everything below',
    '   references them by name.',
    `2. Load the fonts first${bodyFont ? ` (body: **${bodyFont.primary}**${displayFont && displayFont !== bodyFont ? `, display: **${displayFont.primary}**` : ''})` : ''}. A font swap changes every measurement in this brief.`,
    subject.kind === 'component'
      ? '3. Build the component as a standalone, self-contained piece: no page shell, no outer container, no fixed width. It has to drop into a layout that is not this page.'
      : `3. Build a page shell with a centred container at ${design.container.maxWidth ? `\`${design.container.maxWidth}px\`` : 'full width'}.`,
    subject.kind === 'component'
      ? '4. Build it from §3, and take the props from what varies there — every literal that could differ between two instances is a prop, not a hardcoded value.'
      : `4. Build the ${sections.length} sections in the order listed in §2.`,
    components.length
      ? `5. Extract these repeating pieces as components: ${[...new Set(components)].map((c) => `\`<${c} />\``).join(', ')}. Render each from a data array — do not hand-write repeated markup.`
      : '5. No repeating components were detected; build each section directly.',
    `6. Apply responsive behavior at the breakpoints in §1${design.breakpoints.length ? ` (${design.breakpoints.map((b) => `${b}px`).join(', ')})` : ''}.`,
    '',
    '### Acceptance criteria',
    '',
    '- Every color, font size and spacing value comes from the token set, not a literal.',
    ...(shots.length
      ? [
          subject.kind === 'component'
            ? `- Your build, screenshotted beside the element in \`screenshots/${shots[0]}.jpg\`, matches it in proportion, density and weight.`
            : `- Your build at ${VIEWPORTS[shots[0]]?.width ?? '—'}px, screenshotted and placed beside \`screenshots/${shots[0]}.jpg\`, matches it in section order, proportion and density.`,
        ]
      : []),
    subject.kind === 'component'
      ? '- The component renders correctly at a width it was not measured at; nothing depends on the page it came from.'
      : '- Section order and vertical rhythm match §2.',
    '- Repeating groups render from data, with the item count in §3.',
    subject.kind === 'component'
      ? '- The component reflows correctly at each declared breakpoint.'
      : '- The page reflows correctly at each declared breakpoint.',
    mode === 'verbatim'
      ? '- Copy matches the text in §3 exactly.'
      : '- Copy uses the placeholder text in §3; replace it with your own.',
    '',
    '### What this brief does not capture',
    '',
    '- Hover, focus and active states beyond the transition timings recorded above.',
    '- JavaScript behavior: menus, modals, carousels, scroll-driven animation.',
    '- Content below any interaction gate (tabs, accordions) that was closed at capture time.',
    '',
  ].join('\n');
}

export function emitAgentPrompt(
  page: PageMeta,
  design: DesignSystem,
  sections: SectionSpec[],
  assets: AssetManifest,
  mode: ContentMode,
  bundle: BundleFile[],
  subject: BriefSubject = PAGE,
): EmittedFile {
  const parts: string[] = [];

  const component = subject.kind === 'component' ? sections[0] : undefined;

  parts.push(
    component
      ? `# Build brief: ${component.label} component — ${page.title || page.finalUrl}`
      : `# Build brief: ${page.title || page.finalUrl}`,
    '',
    component
      ? 'Rebuild the single component described below — not the page it came from. Every'
      : 'Rebuild the page described below. Every value in this brief was measured from the',
    component
      ? 'value here was measured from the rendered element — computed styles, geometry and'
      : 'rendered page — computed styles, geometry and text — so treat the numbers as exact',
    component
      ? 'text — so treat the numbers as exact rather than approximate.'
      : 'rather than approximate.',
    '',
    component
      ? `**Source:** ${page.finalUrl}  ·  **Element:** \`${subject.selector ?? component.selector}\`  ·  **Extracted:** ${page.extractedAt}  ·  **Content:** ${mode}`
      : `**Source:** ${page.finalUrl}  ·  **Extracted:** ${page.extractedAt}  ·  **Sections:** ${sections.length}  ·  **Content:** ${mode}`,
    '',
  );

  if (page.description) parts.push(`**Page description:** ${page.description}`, '');
  if (page.warnings.length) {
    parts.push('> **Capture caveats**', '>', ...page.warnings.map((w) => `> - ${w}`), '');
  }

  parts.push(bundleSection(page, assets, bundle, mode, subject));
  parts.push(designSystemSection(design));

  if (component) {
    parts.push(
      '## 2. The component',
      '',
      table(
        ['Element', 'Reads as', 'Size on screen', 'Columns', 'Repeats'],
        [
          [
            `\`${subject.selector ?? component.selector}\``,
            component.kind,
            `${component.box[2]}×${component.box[3]}px`,
            component.layout.columns,
            component.repeat ? `${component.repeat.count}× ${component.repeat.componentName}` : '',
          ],
        ],
      ),
      '',
      'It was measured where it sits on the page, so that width is the width it renders at',
      'there — not a width it was designed to fill. Build it to fit its container.',
      '',
      '## 3. The component in detail',
      '',
    );
  } else {
    parts.push(
      '## 2. Page structure',
      '',
      table(
        ['#', 'Section', 'Kind', 'Height', 'Columns', 'Repeats'],
        sections.map((s, i) => [
          i + 1,
          s.heading || s.label,
          s.kind,
          `${s.box[3]}px`,
          s.layout.columns,
          s.repeat ? `${s.repeat.count}× ${s.repeat.componentName}` : '',
        ]),
      ),
      '',
      '## 3. Sections',
      '',
    );
  }

  for (const [index, section] of sections.entries()) {
    parts.push(sectionDetail(section, index, mode));
  }

  parts.push(assetsSection(assets, page.documentHeight, subject));
  parts.push(buildInstructions(design, sections, mode, assets, subject));

  return {
    path: 'AGENT_PROMPT.md',
    contents: parts.join('\n'),
    language: 'markdown',
    description: 'Paste this into an AI coding agent to rebuild the page.',
  };
}

/**
 * A trimmed brief for small context windows.
 *
 * The full brief runs long on a content-heavy page, and a truncated prompt is
 * worse than a shorter one written to be complete: this keeps the whole design
 * system and every section's shape, and drops only the per-item content.
 */
export function emitCompactPrompt(
  page: PageMeta,
  design: DesignSystem,
  sections: SectionSpec[],
  mode: ContentMode,
  assets: AssetManifest,
): EmittedFile {
  const shots = Object.keys(assets.screenshots) as ViewportLabel[];
  const colors = Object.entries(design.palette.roles)
    .map(([role, hex]) => `${role}=${hex}`)
    .join(' · ');

  const type = design.typeScale
    .slice(0, 8)
    .map((t) => `${t.name} ${t.fontSize}/${t.lineHeight} w${t.fontWeight}`)
    .join(' · ');

  const lines = [
    `# Build brief (compact): ${page.title || page.finalUrl}`,
    '',
    `Source: ${page.finalUrl} · ${sections.length} sections · content: ${mode}`,
    '',
    'Measured from the rendered page, so the numbers are exact. This file is part of a',
    'ZIP that also holds the full brief (`AGENT_PROMPT.md`), token files to import,',
    'generated components as a starting point, `spec.json`, and:',
    '',
    shots.length
      ? `- \`screenshots/\` — full-page renders at ${shots
          .map((vp) => `${vp} ${VIEWPORTS[vp]?.width ?? '—'}px`)
          .join(', ')}. Open them before building and compare your result against them after.`
      : '- `screenshots/` — none captured for this run; build from the numbers alone.',
    '',
    '## Tokens',
    '',
    `- **Colors:** ${colors}`,
    `- **Fonts:** ${design.families.map((f) => `${f.primary} (${f.usage})`).join(', ')}`,
    `- **Type scale:** ${type}`,
    `- **Spacing:** ${design.spacing.baseUnit}px base — ${design.spacing.values.join(', ')}`,
    `- **Radii:** ${design.radii.map((r) => `${r.name} ${r.value}`).join(', ') || 'none'}`,
    `- **Shadows:** ${design.shadows.map((s) => s.name).join(', ') || 'none'}`,
    `- **Container:** ${design.container.maxWidth ? `${design.container.maxWidth}px` : 'full bleed'}`,
    `- **Breakpoints:** ${design.breakpoints.join(', ') || 'none'}`,
    '',
    '## Sections',
    '',
  ];

  for (const [i, s] of sections.entries()) {
    const bits = [
      `**${i + 1}. ${s.label}** (\`${s.kind}\`)`,
      `${s.layout.display}${s.layout.columns > 1 ? `, ${s.layout.columns} cols` : ''}`,
      `pad ${s.layout.paddingTop}/${s.layout.paddingBottom}`,
      `bg ${s.background}`,
    ];
    lines.push(`- ${bits.join(' · ')}`);
    if (s.heading) lines.push(`  - Heading: "${applyMode(s.heading, mode)}"`);
    if (s.subheading) lines.push(`  - Sub: "${applyMode(s.subheading, mode)}"`);
    if (s.ctas.length) {
      lines.push(`  - Buttons: ${s.ctas.map((c) => `"${applyMode(c.label, mode)}" (${c.variant})`).join(', ')}`);
    }
    if (s.repeat) {
      lines.push(`  - ${s.repeat.count}× \`<${s.repeat.componentName} />\` in ${s.repeat.columns} cols`);
    }
  }

  lines.push(
    '',
    'Build with the tokens above; do not hardcode values.',
    shots.length
      ? `Check the finished build against \`screenshots/${shots[0]}.jpg\` at ${VIEWPORTS[shots[0]]?.width ?? '—'}px.`
      : '',
    '',
  );

  return {
    path: 'AGENT_PROMPT.compact.md',
    contents: lines.join('\n'),
    language: 'markdown',
    description: 'Shorter brief for small context windows.',
  };
}
