import type { ContentMode, DesignSystem, EmittedFile, SectionSpec } from '../types';
import { applyMode } from './content';

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slug = (input: string): string =>
  input.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'section';

/**
 * Framework-free output.
 *
 * The React bundle assumes a build step and a Tailwind install; this one runs
 * by opening the file. It shares the token names with `tokens.css`, so the two
 * outputs describe the same system rather than diverging.
 */
export function emitHtml(
  design: DesignSystem,
  sections: SectionSpec[],
  mode: ContentMode,
  title: string,
  description: string,
): EmittedFile[] {
  const css: string[] = [
    '/* Layout and section styles. Tokens live in tokens.css. */',
    '*, *::before, *::after { box-sizing: border-box; }',
    'body { margin: 0; background: var(--color-background); color: var(--color-foreground);',
    `  font-family: ${design.families.find((f) => f.usage === 'body')?.stack ?? 'system-ui, sans-serif'};`,
    `  font-size: ${design.typeScale.find((t) => t.name === 'body')?.fontSize ?? 16}px; line-height: 1.6; }`,
    'img { max-width: 100%; height: auto; }',
    'a { color: inherit; text-decoration: none; }',
    '',
    '.container {',
    `  max-width: ${design.container.maxWidth ?? 1200}px;`,
    '  margin-inline: auto;',
    `  padding-inline: ${design.container.paddingX.desktop ?? 24}px;`,
    '}',
    '',
  ];

  for (const token of design.typeScale) {
    css.push(
      `.${token.name} { font-size: ${token.fontSize}px; line-height: ${token.lineHeight};`,
      `  font-weight: ${token.fontWeight}; letter-spacing: ${token.letterSpacing};`,
      token.textTransform !== 'none' ? `  text-transform: ${token.textTransform};` : '',
      token.family ? `  font-family: ${token.family}, sans-serif;` : '',
      '}',
    );
  }
  css.push('');

  const html: string[] = [];

  sections.forEach((section, index) => {
    const id = `${slug(section.kind)}-${index + 1}`;
    const layout = section.layout;

    css.push(
      `#${id} {`,
      `  padding-block: ${layout.paddingTop}px ${layout.paddingBottom}px;`,
      `  background: ${section.background};`,
      section.backgroundImage ? `  background-image: ${section.backgroundImage};` : '',
      `  color: ${section.textColor};`,
      layout.textAlign && layout.textAlign !== 'start' ? `  text-align: ${layout.textAlign};` : '',
      '}',
    );

    if (section.repeat) {
      css.push(
        `#${id} .items {`,
        '  display: grid;',
        `  grid-template-columns: repeat(${section.repeat.columns}, minmax(0, 1fr));`,
        `  gap: ${section.repeat.gap || 24}px;`,
        '  margin-top: 48px;',
        '}',
        `#${id} .item {`,
        `  padding: ${section.repeat.itemLayout.padding};`,
        `  background: ${section.repeat.itemLayout.background};`,
        `  border-radius: ${section.repeat.itemLayout.radius};`,
        section.repeat.itemLayout.border !== 'none' ? `  border: ${section.repeat.itemLayout.border};` : '',
        section.repeat.itemLayout.shadow ? `  box-shadow: ${section.repeat.itemLayout.shadow};` : '',
        '}',
      );
    }

    const tag = section.kind === 'nav' ? 'header' : section.kind === 'footer' ? 'footer' : 'section';
    const body: string[] = [];

    if (section.eyebrow) {
      body.push(`      <p class="eyebrow">${escapeHtml(applyMode(section.eyebrow, mode))}</p>`);
    }
    if (section.heading) {
      const level = Math.min(Math.max(section.headingLevel || 2, 1), 6);
      const token = design.typeScale.find((t) => t.tags.includes(`h${level}`));
      body.push(
        `      <h${level}${token ? ` class="${token.name}"` : ''}>${escapeHtml(applyMode(section.heading, mode))}</h${level}>`,
      );
    }
    if (section.subheading) {
      body.push(`      <p class="lede">${escapeHtml(applyMode(section.subheading, mode))}</p>`);
    }

    if (section.navLinks.length) {
      body.push('      <nav class="links">');
      for (const link of section.navLinks.slice(0, 16)) {
        body.push(
          `        <a href="${escapeHtml(link.href || '#')}">${escapeHtml(applyMode(link.label, mode))}</a>`,
        );
      }
      body.push('      </nav>');
    }

    if (section.repeat) {
      body.push('      <div class="items">');
      for (const item of section.repeat.items) {
        body.push('        <article class="item">');
        if (item.image) {
          body.push(
            `          <img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}" width="${item.image.width}" height="${item.image.height}">`,
          );
        }
        if (item.heading) {
          body.push(`          <h3>${escapeHtml(applyMode(item.heading, mode))}</h3>`);
        }
        if (item.body) body.push(`          <p>${escapeHtml(applyMode(item.body, mode))}</p>`);
        body.push('        </article>');
      }
      body.push('      </div>');
    }

    if (section.ctas.length && !section.repeat) {
      body.push('      <div class="actions">');
      for (const cta of section.ctas) {
        body.push(
          `        <a class="btn btn-${cta.variant}" href="${escapeHtml(cta.href || '#')}">${escapeHtml(applyMode(cta.label, mode))}</a>`,
        );
      }
      body.push('      </div>');
    }

    html.push(
      `    <${tag} id="${id}">`,
      '      <div class="container">',
      ...body,
      '      </div>',
      `    </${tag}>`,
    );
  });

  const primary = design.palette.roles.primary ?? '#111111';
  css.push(
    '',
    '.actions { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 32px; }',
    '.links { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; }',
    '.lede { color: var(--color-muted, #666); }',
    '.eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 13px; font-weight: 600; }',
    '.btn { display: inline-flex; align-items: center; font-weight: 600;',
    `  padding: 10px 20px; border-radius: ${design.radii[0]?.value ?? '6px'}; }`,
    `.btn-primary { background: ${primary}; color: #fff; }`,
    '.btn-secondary { border: 1px solid var(--color-border, #ddd); }',
    '.btn-link { padding-inline: 0; }',
    '',
  );

  if (design.breakpoints.length) {
    const breakpoint = design.breakpoints.find((b) => b >= 700) ?? design.breakpoints[0];
    css.push(
      `@media (max-width: ${breakpoint - 1}px) {`,
      '  .items { grid-template-columns: 1fr !important; }',
      '  .links { gap: 16px; }',
      '}',
      '',
    );
  }

  const fontLinks = design.families
    .filter((f) => f.source === 'google')
    .map(
      (f) =>
        `  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.primary.replace(/\s+/g, '+')}:wght@${(f.weights.length ? f.weights : [400, 700]).join(';')}&display=swap">`,
    );

  const document = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(applyMode(title, mode))}</title>`,
    description ? `  <meta name="description" content="${escapeHtml(applyMode(description, mode))}">` : '',
    ...fontLinks,
    '  <link rel="stylesheet" href="tokens.css">',
    '  <link rel="stylesheet" href="styles.css">',
    '</head>',
    '<body>',
    ...html,
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return [
    {
      path: 'index.html',
      contents: document,
      language: 'html',
      description: 'Framework-free rebuild of the page structure.',
    },
    {
      path: 'styles.css',
      contents: css.filter((line) => line !== '').join('\n') + '\n',
      language: 'css',
      description: 'Layout and section styles for index.html.',
    },
  ];
}
