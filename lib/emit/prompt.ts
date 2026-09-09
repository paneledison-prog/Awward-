import type {
  AssetManifest,
  ContentMode,
  DesignSystem,
  EmittedFile,
  PageMeta,
  SectionSpec,
} from '../types';
import { applyMode } from './content';

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

function assetsSection(assets: AssetManifest): string {
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

  const shots = Object.entries(assets.screenshots);
  if (shots.length) {
    out.push('### Reference screenshots', '');
    out.push(...shots.map(([vp, path]) => `- \`${vp}\`: \`${path}\``), '');
  }

  return out.join('\n');
}

function buildInstructions(design: DesignSystem, sections: SectionSpec[], mode: ContentMode): string {
  const components = sections.filter((s) => s.repeat).map((s) => s.repeat!.componentName);
  const bodyFont = design.families.find((f) => f.usage === 'body');
  const displayFont = design.families.find((f) => f.usage === 'display');

  return [
    '## 5. Build instructions',
    '',
    '1. Start from the design tokens. Put the color, type, spacing, radius and shadow values',
    '   into your theme configuration *before* writing any markup — every section below',
    '   references them by name.',
    `2. Load the fonts first${bodyFont ? ` (body: **${bodyFont.primary}**${displayFont && displayFont !== bodyFont ? `, display: **${displayFont.primary}**` : ''})` : ''}. A font swap changes every measurement in this brief.`,
    `3. Build a page shell with a centred container at ${design.container.maxWidth ? `\`${design.container.maxWidth}px\`` : 'full width'}.`,
    `4. Build the ${sections.length} sections in the order listed in §2.`,
    components.length
      ? `5. Extract these repeating pieces as components: ${[...new Set(components)].map((c) => `\`<${c} />\``).join(', ')}. Render each from a data array — do not hand-write repeated markup.`
      : '5. No repeating components were detected; build each section directly.',
    `6. Apply responsive behavior at the breakpoints in §1${design.breakpoints.length ? ` (${design.breakpoints.map((b) => `${b}px`).join(', ')})` : ''}.`,
    '',
    '### Acceptance criteria',
    '',
    '- Every color, font size and spacing value comes from the token set, not a literal.',
    '- Section order and vertical rhythm match §2.',
    '- Repeating groups render from data, with the item count in §3.',
    '- The page reflows correctly at each declared breakpoint.',
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
): EmittedFile {
  const parts: string[] = [];

  parts.push(
    `# Build brief: ${page.title || page.finalUrl}`,
    '',
    'Rebuild the page described below. Every value in this brief was measured from the',
    'rendered page — computed styles, geometry and text — so treat the numbers as exact',
    'rather than approximate.',
    '',
    `**Source:** ${page.finalUrl}  ·  **Extracted:** ${page.extractedAt}  ·  **Sections:** ${sections.length}  ·  **Content:** ${mode}`,
    '',
  );

  if (page.description) parts.push(`**Page description:** ${page.description}`, '');
  if (page.warnings.length) {
    parts.push('> **Capture caveats**', '>', ...page.warnings.map((w) => `> - ${w}`), '');
  }

  parts.push(designSystemSection(design));

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

  for (const [index, section] of sections.entries()) {
    parts.push(sectionDetail(section, index, mode));
  }

  parts.push(assetsSection(assets));
  parts.push(buildInstructions(design, sections, mode));

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
): EmittedFile {
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

  lines.push('', 'Build with the tokens above; do not hardcode values.', '');

  return {
    path: 'AGENT_PROMPT.compact.md',
    contents: lines.join('\n'),
    language: 'markdown',
    description: 'Shorter brief for small context windows.',
  };
}
