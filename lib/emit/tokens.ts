import type { DesignSystem, EmittedFile } from '../types';

const jsonQuote = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`);

/** Colors keyed by token name, roles first so the semantic names are obvious. */
function colorMap(design: DesignSystem): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, hex] of Object.entries(design.palette.roles)) {
    if (hex) out[role] = hex;
  }
  for (const token of design.palette.tokens) {
    if (!out[token.name]) out[token.name] = token.hex;
  }
  return out;
}

export function emitDesignTokens(design: DesignSystem): EmittedFile {
  const tokens = {
    colors: colorMap(design),
    colorRoles: design.palette.roles,
    darkColors: design.darkPalette ? colorMap({ ...design, palette: design.darkPalette }) : undefined,
    typography: {
      families: design.families.map((f) => ({
        name: f.primary,
        stack: f.stack,
        usage: f.usage,
        source: f.source,
        weights: f.weights,
      })),
      scale: design.typeScale.map((t) => ({
        name: t.name,
        fontSize: `${t.fontSize}px`,
        lineHeight: t.lineHeight,
        fontWeight: t.fontWeight,
        letterSpacing: t.letterSpacing,
        family: t.family,
        textTransform: t.textTransform === 'none' ? undefined : t.textTransform,
      })),
    },
    spacing: {
      baseUnit: `${design.spacing.baseUnit}px`,
      confidence: design.spacing.confidence,
      values: design.spacing.values.map((v) => `${v}px`),
    },
    radii: Object.fromEntries(design.radii.map((r) => [r.name, r.value])),
    shadows: Object.fromEntries(design.shadows.map((s) => [s.name, s.value])),
    borderWidths: design.borderWidths.map((b) => b.value),
    motion: {
      durations: design.motion.durations.map((d) => d.value),
      easings: design.motion.easings.map((e) => e.value),
      keyframes: design.motion.keyframes,
    },
    breakpoints: design.breakpoints.map((b) => `${b}px`),
    container: {
      maxWidth: design.container.maxWidth ? `${design.container.maxWidth}px` : null,
      paddingX: design.container.paddingX,
    },
    sourceVariables: design.sourceVariables,
  };

  return {
    path: 'design-tokens.json',
    contents: JSON.stringify(tokens, null, 2),
    language: 'json',
    description: 'Machine-readable design system: colors, type, spacing, effects.',
  };
}

export function emitTokensCss(design: DesignSystem): EmittedFile {
  const lines: string[] = [
    '/* Design tokens extracted from the source page.',
    '   Every value below was measured from rendered output, not guessed. */',
    ':root {',
  ];

  lines.push('  /* Color */');
  for (const [name, hex] of Object.entries(colorMap(design))) {
    lines.push(`  --color-${name}: ${hex};`);
  }

  lines.push('', '  /* Typography */');
  for (const family of design.families) {
    lines.push(`  --font-${family.usage}: ${family.stack};`);
  }
  for (const token of design.typeScale) {
    lines.push(`  --text-${token.name}: ${token.fontSize}px;`);
    lines.push(`  --leading-${token.name}: ${token.lineHeight};`);
  }

  lines.push('', '  /* Spacing */');
  for (const value of design.spacing.values) lines.push(`  --space-${value}: ${value}px;`);

  if (design.radii.length) {
    lines.push('', '  /* Radius */');
    for (const radius of design.radii) lines.push(`  --radius-${radius.name}: ${radius.value};`);
  }

  if (design.shadows.length) {
    lines.push('', '  /* Elevation */');
    for (const shadow of design.shadows) lines.push(`  --shadow-${shadow.name}: ${shadow.value};`);
  }

  if (design.container.maxWidth) {
    lines.push('', '  /* Layout */', `  --container-max: ${design.container.maxWidth}px;`);
  }

  const duration = design.motion.durations[0]?.value;
  const easing = design.motion.easings[0]?.value;
  if (duration || easing) {
    lines.push('', '  /* Motion */');
    if (duration) lines.push(`  --duration: ${duration};`);
    if (easing) lines.push(`  --easing: ${easing};`);
  }

  lines.push('}');

  if (design.darkPalette) {
    lines.push('', '@media (prefers-color-scheme: dark) {', '  :root {');
    for (const [name, hex] of Object.entries(colorMap({ ...design, palette: design.darkPalette }))) {
      lines.push(`    --color-${name}: ${hex};`);
    }
    lines.push('  }', '}');
  }

  return {
    path: 'tokens.css',
    contents: lines.join('\n') + '\n',
    language: 'css',
    description: 'The same tokens as CSS custom properties.',
  };
}

/**
 * Tailwind v3 config.
 *
 * Both v3 and v4 are in wide use and agents encounter both, so the bundle ships
 * a config for each rather than betting on which one the target project uses.
 */
export function emitTailwindConfig(design: DesignSystem): EmittedFile {
  const colors = colorMap(design);
  // A token named `text-20` would become the class `text-text-20`; Tailwind adds
  // the prefix itself.
  const fontSize = Object.fromEntries(
    design.typeScale.map((t) => [
      t.name.startsWith('text-') ? t.name.slice(5) : t.name,
      [
        `${t.fontSize}px`,
        {
          lineHeight: String(t.lineHeight),
          letterSpacing: t.letterSpacing === 'normal' ? '0' : t.letterSpacing,
          fontWeight: String(t.fontWeight),
        },
      ],
    ]),
  );

  const fontFamily: Record<string, string[]> = {};
  for (const family of design.families) {
    fontFamily[family.usage] = family.stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  }

  const screens = Object.fromEntries(design.breakpoints.map((b) => [`bp${b}`, `${b}px`]));

  const config = {
    theme: {
      extend: {
        colors,
        fontFamily,
        fontSize,
        // Spacing is deliberately absent: overriding keys like `96` would
        // silently redefine stock Tailwind classes across the whole project.
        // The measured scale lives in design-tokens.json and tokens.css.
        borderRadius: Object.fromEntries(design.radii.map((r) => [r.name, r.value])),
        boxShadow: Object.fromEntries(design.shadows.map((s) => [s.name, s.value])),
        screens,
        maxWidth: design.container.maxWidth ? { container: `${design.container.maxWidth}px` } : {},
        transitionDuration: design.motion.durations[0]
          ? { DEFAULT: design.motion.durations[0].value }
          : {},
        transitionTimingFunction: design.motion.easings[0]
          ? { DEFAULT: design.motion.easings[0].value }
          : {},
      },
    },
  };

  const body = JSON.stringify(config, null, 2).replace(/"([^"]+)":/g, (_, key) => `${jsonQuote(key)}:`);

  return {
    path: 'tailwind.config.js',
    contents: [
      '/** Tailwind v3 config generated from the extracted design system. */',
      '/** @type {import("tailwindcss").Config} */',
      'module.exports = {',
      "  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],",
      `  ...${body},`,
      '  plugins: [],',
      '};',
      '',
    ].join('\n'),
    language: 'javascript',
    description: 'Tailwind v3 theme wired to the extracted tokens.',
  };
}

/** Tailwind v4 declares its theme in CSS rather than a JS config. */
export function emitTailwindTheme(design: DesignSystem): EmittedFile {
  const lines = ['@import "tailwindcss";', '', '@theme {'];

  for (const [name, hex] of Object.entries(colorMap(design))) {
    lines.push(`  --color-${name}: ${hex};`);
  }
  for (const family of design.families) {
    lines.push(`  --font-${family.usage}: ${family.stack};`);
  }
  for (const token of design.typeScale) {
    lines.push(`  --text-${token.name}: ${token.fontSize}px;`);
    lines.push(`  --text-${token.name}--line-height: ${token.lineHeight};`);
    lines.push(`  --text-${token.name}--font-weight: ${token.fontWeight};`);
  }
  for (const value of design.spacing.values) lines.push(`  --spacing-${value}: ${value}px;`);
  for (const radius of design.radii) lines.push(`  --radius-${radius.name}: ${radius.value};`);
  for (const shadow of design.shadows) lines.push(`  --shadow-${shadow.name}: ${shadow.value};`);
  for (const breakpoint of design.breakpoints) {
    lines.push(`  --breakpoint-bp${breakpoint}: ${breakpoint}px;`);
  }

  lines.push('}', '');

  return {
    path: 'theme.css',
    contents: lines.join('\n'),
    language: 'css',
    description: 'Tailwind v4 @theme block with the same tokens.',
  };
}
