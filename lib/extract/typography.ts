import type {
  FontFamilySpec,
  HarvestNetworkEntry,
  HarvestNode,
  HarvestResult,
  TypeToken,
} from '../types';

/** Text shorter than this is treated as a label, not body copy. */
const BODY_MIN_CHARS = 60;

const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system',
  'blinkmacsystemfont', 'inherit', 'initial',
]);

const SYSTEM_FACES = new Set([
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue',
  'helvetica', 'arial', 'system-ui', 'ui-sans-serif', 'sans-serif', 'noto sans',
]);

export function primaryFamily(stack: string): string {
  for (const part of stack.split(',')) {
    const name = part.trim().replace(/^["']|["']$/g, '');
    if (name && !GENERIC.has(name.toLowerCase())) return name;
  }
  return stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
}

/** Computed line-height arrives as px (or "normal"); express it as a ratio. */
function lineHeightRatio(lineHeight: string, fontSize: number): number {
  if (!lineHeight || lineHeight === 'normal') return 1.2;
  const px = parseFloat(lineHeight);
  if (!Number.isFinite(px) || fontSize <= 0) return 1.2;
  return Number((px / fontSize).toFixed(3));
}

interface SizeGroup {
  fontSize: number;
  fontWeight: number;
  weights: Map<number, number>;
  lineHeights: Map<number, number>;
  letterSpacings: Map<string, number>;
  families: Map<string, number>;
  transforms: Map<string, number>;
  tags: Map<string, number>;
  chars: number;
  count: number;
  sample: string;
}

const bump = <K>(map: Map<K, number>, key: K, by = 1): void => {
  map.set(key, (map.get(key) ?? 0) + by);
};

const topKey = <K>(map: Map<K, number>, fallback: K): K => {
  let best: K = fallback;
  let bestValue = -1;
  for (const [key, value] of map) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
};

/**
 * Group text by size *and* weight.
 *
 * Grouping on size alone merges a 20px/600 card heading with 20px/400 body
 * copy, and whichever has more characters decides the reported weight — so the
 * emitted heading token comes out at the wrong weight.
 */
function groupByStyle(nodes: HarvestNode[]): Map<string, SizeGroup> {
  const groups = new Map<string, SizeGroup>();

  for (const node of nodes) {
    if (!node.text) continue;
    const size = Math.round(parseFloat(node.styles.fontSize) || 0);
    if (size <= 0) continue;
    const weight = Math.round(parseFloat(node.styles.fontWeight) || 400);
    const key = `${size}:${weight}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        fontSize: size,
        fontWeight: weight,
        weights: new Map(),
        lineHeights: new Map(),
        letterSpacings: new Map(),
        families: new Map(),
        transforms: new Map(),
        tags: new Map(),
        chars: 0,
        count: 0,
        sample: '',
      };
      groups.set(key, group);
    }

    const chars = node.text.length;
    bump(group.weights, weight, chars);
    bump(group.lineHeights, lineHeightRatio(node.styles.lineHeight, size), chars);
    bump(group.letterSpacings, node.styles.letterSpacing || 'normal', chars);
    bump(group.families, node.styles.fontFamily, chars);
    bump(group.transforms, node.styles.textTransform || 'none', chars);
    bump(group.tags, node.tag, 1);
    group.chars += chars;
    group.count += 1;
    // Keep the longest sample seen; it reads best in the generated spec.
    if (node.text.length > group.sample.length) group.sample = node.text.slice(0, 90);
  }

  return groups;
}

/**
 * Build a named type scale.
 *
 * Heading tags name their own sizes first, because a `<h2>` is an h2 no matter
 * where it lands in the size ordering. Only the sizes no tag claimed fall back
 * to positional names, which keeps the scale stable on pages that use, say, a
 * 44px price display alongside a 40px h2.
 */
/**
 * Build a named type scale.
 *
 * Heading tags name their own steps first, because an `<h2>` is an h2 wherever
 * it lands in the size ordering. Everything else is named by its size, which
 * keeps names unique and honest — inventing "display" for a 44px price that
 * sits below a 64px h1 reads as a scale the site does not have.
 */
export function buildTypeScale(nodes: HarvestNode[]): { scale: TypeToken[]; bodySize: number } {
  const groups = [...groupByStyle(nodes).values()].sort(
    (a, b) => b.fontSize - a.fontSize || b.fontWeight - a.fontWeight,
  );
  if (groups.length === 0) return { scale: [], bodySize: 16 };

  // Body size is the step carrying the most actual prose, not the most nodes.
  const proseGroups = groups.filter((g) => g.chars >= BODY_MIN_CHARS);
  const bodyGroup = [...(proseGroups.length ? proseGroups : groups)].sort(
    (a, b) => b.chars - a.chars,
  )[0];

  const names = new Map<SizeGroup, string>();
  const used = new Set<string>();
  const claim = (group: SizeGroup, name: string): void => {
    names.set(group, name);
    used.add(name);
  };

  claim(bodyGroup, 'body');

  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    if (used.has(tag)) continue;
    const owner = groups
      .filter((g) => (g.tags.get(tag) ?? 0) > 0 && !names.has(g))
      .sort((a, b) => (b.tags.get(tag) ?? 0) - (a.tags.get(tag) ?? 0))[0];
    if (owner) claim(owner, tag);
  }

  // "display" is only meaningful for the single largest step on the page.
  const largest = groups[0];
  if (!names.has(largest) && largest.fontSize > bodyGroup.fontSize) claim(largest, 'display');

  // Steps below body have unambiguous names available, largest first.
  const below = ['small', 'caption', 'micro'];
  let belowIdx = 0;
  for (const group of groups.filter((g) => g.fontSize < bodyGroup.fontSize && !names.has(g))) {
    while (belowIdx < below.length && used.has(below[belowIdx])) belowIdx++;
    if (belowIdx >= below.length) break;
    claim(group, below[belowIdx]);
  }

  // Anything still unnamed is described by its own metrics rather than forced
  // into a semantic slot it does not occupy.
  for (const group of groups) {
    if (names.has(group)) continue;
    let name = `text-${group.fontSize}`;
    if (used.has(name)) name = `${name}-${group.fontWeight}`;
    let suffix = 2;
    while (used.has(name)) name = `text-${group.fontSize}-${suffix++}`;
    claim(group, name);
  }

  const scale: TypeToken[] = groups
    // A step used once by a single node is incidental, unless it is a heading
    // or larger than body — those are real even when they appear once.
    .filter((g) => g.count > 1 || g.fontSize >= bodyGroup.fontSize)
    .map((g) => ({
      name: names.get(g) ?? `text-${g.fontSize}`,
      fontSize: g.fontSize,
      lineHeight: topKey(g.lineHeights, 1.5),
      fontWeight: g.fontWeight,
      letterSpacing: topKey(g.letterSpacings, 'normal'),
      family: primaryFamily(topKey(g.families, '')),
      textTransform: topKey(g.transforms, 'none'),
      tags: [...g.tags.keys()].slice(0, 6),
      count: g.count,
      sample: g.sample,
    }));

  return { scale, bodySize: bodyGroup.fontSize };
}

/* ------------------------------------------------------------------ */
/* Font families and where they come from                              */
/* ------------------------------------------------------------------ */

const FONT_FILE_RE = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

function googleFamiliesFrom(network: HarvestNetworkEntry[]): Set<string> {
  const families = new Set<string>();
  for (const entry of network) {
    if (!entry.url.includes('fonts.googleapis.com')) continue;
    try {
      const url = new URL(entry.url);
      for (const value of url.searchParams.getAll('family')) {
        // css2 uses "Inter:wght@400;700"; css v1 uses "Inter:400,700".
        families.add(value.split(':')[0].replace(/\+/g, ' ').trim());
      }
    } catch {
      /* malformed font URL — nothing to learn from it */
    }
  }
  return families;
}

function buildImportCode(spec: Omit<FontFamilySpec, 'importCode'>): string {
  const weights = spec.weights.length ? [...new Set(spec.weights)].sort((a, b) => a - b) : [400, 700];

  if (spec.source === 'google') {
    const family = spec.primary.replace(/\s+/g, '+');
    const href = `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(';')}&display=swap`;
    return [
      `/* CSS */`,
      `@import url('${href}');`,
      ``,
      `// next/font (preferred in Next.js — self-hosts and avoids a round trip)`,
      `import { ${spec.primary.replace(/[^A-Za-z0-9]/g, '_')} } from 'next/font/google';`,
      `const font = ${spec.primary.replace(/[^A-Za-z0-9]/g, '_')}({`,
      `  subsets: ['latin'],`,
      `  weight: [${weights.map((w) => `'${w}'`).join(', ')}],`,
      `  display: 'swap',`,
      `});`,
    ].join('\n');
  }

  if (spec.source === 'self-hosted') {
    return [
      `/* Self-hosted. Copy the files, then declare them: */`,
      ...spec.urls.slice(0, 4).map(
        (url) =>
          `@font-face { font-family: '${spec.primary}'; src: url('${url}') format('woff2'); font-display: swap; }`,
      ),
      ``,
      `/* Original sources:`,
      ...spec.urls.slice(0, 8).map((u) => ` * ${u}`),
      ` */`,
    ].join('\n');
  }

  if (spec.source === 'adobe') {
    return `/* Adobe Fonts (Typekit). Add your own kit id: */\n@import url('https://use.typekit.net/YOUR_KIT.css');`;
  }

  if (spec.source === 'system') {
    return `/* System stack — no import needed. */\nfont-family: ${spec.stack};`;
  }

  // The stack names a font, but no matching file was loaded: either the visitor
  // had it installed or the page silently fell back. Saying "no import needed"
  // here would be wrong, so name the ambiguity and give the likely fix.
  return [
    `/* "${spec.primary}" is requested by the stack, but no font file was served`,
    ` * with the page. It either resolved from a local install or fell back to`,
    ` * the next family. To use it deliberately, load it explicitly: */`,
    `@import url('https://fonts.googleapis.com/css2?family=${spec.primary.replace(/\s+/g, '+')}:wght@${weights.join(';')}&display=swap');`,
    ``,
    `font-family: ${spec.stack};`,
  ].join('\n');
}

/**
 * Identify the typefaces in use and how to obtain each one.
 *
 * Knowing a page uses "Sora" is not actionable on its own; the agent needs the
 * import line, which depends on where the font was actually served from.
 */
export function buildFontFamilies(
  nodes: HarvestNode[],
  network: HarvestNetworkEntry[],
  headingSizes: Set<number>,
): FontFamilySpec[] {
  const stacks = new Map<string, { area: number; weights: Set<number>; headingArea: number }>();

  for (const node of nodes) {
    if (!node.text) continue;
    const stack = node.styles.fontFamily;
    if (!stack) continue;
    const size = Math.round(parseFloat(node.styles.fontSize) || 0);
    const weight = Math.round(parseFloat(node.styles.fontWeight) || 400);
    const area = node.text.length * size;

    const entry = stacks.get(stack) ?? { area: 0, weights: new Set<number>(), headingArea: 0 };
    entry.area += area;
    entry.weights.add(weight);
    if (headingSizes.has(size)) entry.headingArea += area;
    stacks.set(stack, entry);
  }

  const googleFamilies = googleFamiliesFrom(network);
  const fontFileUrls = network.filter((e) => FONT_FILE_RE.test(e.url)).map((e) => e.url);
  const hasTypekit = network.some((e) => e.url.includes('use.typekit.net'));

  const specs = [...stacks.entries()]
    .sort((a, b) => b[1].area - a[1].area)
    .slice(0, 6)
    .map(([stack, info]) => {
      const primary = primaryFamily(stack);
      const lower = primary.toLowerCase();

      // Match font files to the family by name; hashed filenames will not
      // match, so an unmatched self-hosted family still reports every URL.
      const matching = fontFileUrls.filter((url) =>
        url.toLowerCase().includes(lower.replace(/\s+/g, '').slice(0, 8)),
      );

      let source: FontFamilySpec['source'] = 'unknown';
      if ([...googleFamilies].some((f) => f.toLowerCase() === lower)) source = 'google';
      else if (matching.length > 0) source = 'self-hosted';
      else if (SYSTEM_FACES.has(lower)) source = 'system';
      else if (hasTypekit) source = 'adobe';
      else if (fontFileUrls.length > 0) source = 'self-hosted';

      const base: Omit<FontFamilySpec, 'importCode'> = {
        stack,
        primary,
        source,
        weights: [...info.weights].sort((a, b) => a - b),
        urls: matching.length ? matching : source === 'self-hosted' ? fontFileUrls.slice(0, 6) : [],
        area: Math.round(info.area),
        usage: /mono|code|courier/i.test(stack)
          ? 'mono'
          : info.headingArea > info.area * 0.5
            ? 'display'
            : 'body',
      };

      return { ...base, importCode: buildImportCode(base) };
    });

  // The largest non-mono family is the body face, whatever the heading ratio said.
  const body = specs.find((s) => s.usage !== 'mono');
  if (body && body.usage !== 'display') body.usage = 'body';

  return specs;
}

export function headingSizesFrom(scale: TypeToken[]): Set<number> {
  return new Set(
    scale.filter((t) => /^(display|h[1-6])$/.test(t.name)).map((t) => t.fontSize),
  );
}

export function fontsFromHarvest(harvest: HarvestResult): string[] {
  return [...new Set(harvest.fonts.map((f) => f.family))];
}
