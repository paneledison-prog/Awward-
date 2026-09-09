import { parse, converter, formatHex, type Oklch } from 'culori';
import type { ColorRole, ColorToken, HarvestNode, HarvestResult, Palette } from '../types';

const toOklch = converter('oklch');

/** Matches any CSS color notation Chrome can hand back from a computed style. */
const COLOR_RE =
  /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g;

/** Below this, a color is effectively invisible and only adds noise. */
const MIN_ALPHA = 0.08;
/**
 * Perceptual radius (OKLab) inside which two colors are treated as one token.
 * Computed styles report exact authored values, not sampled pixels, so this
 * only needs to absorb rounding: adjacent steps of a real ramp are ~0.056
 * apart and sibling brand shades ~0.079, while #ffffff and #f8fafc — two
 * distinct tokens — are only 0.016 apart.
 */
const MERGE_DISTANCE = 0.008;
/**
 * Below this chroma a color reads as grey and is named on the neutral ramp.
 * Tinted neutrals go surprisingly high: Tailwind's slate ramp peaks around
 * 0.041, so a lower cut mislabels every slate as "indigo".
 */
const NEUTRAL_CHROMA = 0.05;

interface Observation {
  hex: string;
  rgb: [number, number, number];
  alpha: number;
  oklch: { l: number; c: number; h: number };
  area: number;
  property: string;
  /** True when the observation came from a button or link background. */
  onInteractive: boolean;
}

interface ParsedColor {
  hex: string;
  rgb: [number, number, number];
  alpha: number;
  oklch: { l: number; c: number; h: number };
}

export function parseColor(input: string): ParsedColor | null {
  if (!input || input === 'none' || input === 'transparent' || input === 'currentcolor') return null;
  const parsed = parse(input);
  if (!parsed) return null;

  const alpha = parsed.alpha ?? 1;
  if (alpha < MIN_ALPHA) return null;

  const lch = toOklch(parsed) as Oklch | undefined;
  if (!lch) return null;

  // formatHex ignores alpha, which is what we want: the token is the color,
  // and the alpha is recorded separately.
  const hex = formatHex({ ...parsed, alpha: 1 }) ?? '#000000';
  const rgbConv = converter('rgb')(parsed);

  return {
    hex,
    rgb: [
      Math.round((rgbConv?.r ?? 0) * 255),
      Math.round((rgbConv?.g ?? 0) * 255),
      Math.round((rgbConv?.b ?? 0) * 255),
    ],
    alpha,
    oklch: {
      l: Number((lch.l ?? 0).toFixed(4)),
      c: Number((lch.c ?? 0).toFixed(4)),
      // Hue is undefined for pure greys; 0 keeps arithmetic well-defined.
      h: Number((lch.h ?? 0).toFixed(2)),
    },
  };
}

function isInteractive(node: HarvestNode): boolean {
  if (node.tag === 'button' || node.tag === 'a') return true;
  if (node.role === 'button' || node.role === 'link') return true;
  return /\b(btn|button|cta)\b/i.test(node.cls);
}

/**
 * Collect every color the page renders, weighted by the area it covers.
 *
 * Area weighting rather than raw counts is what makes the palette match what a
 * person sees: a full-bleed hero background matters more than fifty 1px borders,
 * even though the borders occur far more often.
 */
export function collectObservations(nodes: HarvestNode[]): Observation[] {
  const out: Observation[] = [];

  const push = (
    raw: string,
    area: number,
    property: string,
    onInteractive: boolean,
  ): void => {
    const c = parseColor(raw);
    if (!c || area <= 0) return;
    out.push({ ...c, area, property, onInteractive });
  };

  for (const node of nodes) {
    const s = node.styles;
    const area = node.area;
    const interactive = isInteractive(node);

    // Text color counts only where text actually exists, and is weighted by an
    // estimate of the glyph area rather than the element box, so a large empty
    // wrapper inheriting a color cannot outvote real body copy.
    if (node.text) {
      const fontSize = parseFloat(s.fontSize) || 16;
      const glyphArea = node.text.length * fontSize * 0.5;
      push(s.color, Math.min(glyphArea, area || glyphArea), 'color', interactive);
    }

    push(s.backgroundColor, area, 'background-color', interactive);

    if (node.hasBorder) {
      // A border's visible area is its perimeter times its width.
      const [, , w, h] = node.box;
      const bw = parseFloat(s.borderTopWidth) || 1;
      push(s.borderTopColor, (w + h) * 2 * bw, 'border-color', false);
    }

    if (s.backgroundImage && s.backgroundImage !== 'none') {
      for (const match of s.backgroundImage.match(COLOR_RE) ?? []) {
        // Gradient stops rarely cover the whole element; damp them so a subtle
        // background wash cannot be mistaken for the page background.
        push(match, area * 0.3, 'gradient-stop', false);
      }
    }

    if (s.boxShadow && s.boxShadow !== 'none') {
      const match = s.boxShadow.match(COLOR_RE)?.[0];
      if (match) push(match, area * 0.05, 'box-shadow', false);
    }

    if (node.svg) {
      push(s.fill, area, 'fill', interactive);
      push(s.stroke, area, 'stroke', interactive);
    }
  }

  return out;
}

function oklabDistance(
  a: { l: number; c: number; h: number },
  b: { l: number; c: number; h: number },
): number {
  // Compare in OKLab so hue differences shrink appropriately at low chroma;
  // comparing hue angles directly makes near-greys look wildly far apart.
  const toAb = (x: { l: number; c: number; h: number }) => {
    const rad = (x.h * Math.PI) / 180;
    return [x.l, x.c * Math.cos(rad), x.c * Math.sin(rad)] as const;
  };
  const [l1, a1, b1] = toAb(a);
  const [l2, a2, b2] = toAb(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

interface Cluster {
  hex: string;
  rgb: [number, number, number];
  alpha: number;
  oklch: { l: number; c: number; h: number };
  area: number;
  count: number;
  /**
   * Area contributed by each CSS property separately.
   *
   * A single color is usually both a background somewhere and text somewhere
   * else. Ranking text colors by the cluster's total area lets a huge white
   * background outvote the real body text, so each role must be ranked by the
   * area from the property that role is actually about.
   */
  propertyAreas: Map<string, number>;
  interactiveArea: number;
}

const areaFor = (c: Cluster, property: string): number => c.propertyAreas.get(property) ?? 0;

/** Merge observations that differ only by antialiasing or a hair of opacity. */
export function clusterColors(observations: Observation[]): Cluster[] {
  const clusters: Cluster[] = [];
  // Process the largest areas first so each cluster keeps the dominant color's
  // exact value as its representative rather than a rare near-miss.
  const sorted = [...observations].sort((a, b) => b.area - a.area);

  for (const obs of sorted) {
    const hit = clusters.find((c) => oklabDistance(c.oklch, obs.oklch) < MERGE_DISTANCE);
    if (hit) {
      hit.area += obs.area;
      hit.count += 1;
      hit.propertyAreas.set(obs.property, areaFor(hit, obs.property) + obs.area);
      if (obs.onInteractive) hit.interactiveArea += obs.area;
    } else {
      clusters.push({
        hex: obs.hex,
        rgb: obs.rgb,
        alpha: obs.alpha,
        oklch: obs.oklch,
        area: obs.area,
        count: 1,
        propertyAreas: new Map([[obs.property, obs.area]]),
        interactiveArea: obs.onInteractive ? obs.area : 0,
      });
    }
  }

  return clusters.sort((a, b) => b.area - a.area);
}

const HUE_NAMES: [number, string][] = [
  [15, 'red'], [45, 'orange'], [75, 'amber'], [105, 'yellow'], [135, 'lime'],
  [165, 'green'], [195, 'teal'], [225, 'cyan'], [255, 'blue'], [285, 'indigo'],
  [315, 'violet'], [345, 'pink'], [360, 'red'],
];

function lightnessStep(l: number): number {
  const steps: [number, number][] = [
    [0.97, 50], [0.93, 100], [0.87, 200], [0.79, 300], [0.70, 400],
    [0.61, 500], [0.52, 600], [0.42, 700], [0.30, 800], [0, 900],
  ];
  for (const [threshold, step] of steps) if (l >= threshold) return step;
  return 950;
}

export function nameColor(oklch: { l: number; c: number; h: number }): string {
  const step = lightnessStep(oklch.l);
  if (oklch.c < NEUTRAL_CHROMA) return `neutral-${step}`;
  const hue = HUE_NAMES.find(([max]) => oklch.h < max)?.[1] ?? 'red';
  return `${hue}-${step}`;
}

/**
 * Turn clusters into named tokens and assign semantic roles.
 *
 * Roles are what make the output usable: an agent handed twelve hex codes has
 * to guess which one is the button, whereas `primary` and `background` map
 * straight onto a theme.
 */
export function buildPalette(nodes: HarvestNode[]): Palette {
  const observations = collectObservations(nodes);
  const clusters = clusterColors(observations);

  // Each role is ranked by the area of the property that defines it.
  const byProperty = (property: string): Cluster[] =>
    clusters
      .filter((c) => areaFor(c, property) > 0)
      .sort((a, b) => areaFor(b, property) - areaFor(a, property));

  const backgrounds = byProperty('background-color');
  const texts = byProperty('color');
  const borders = byProperty('border-color');

  const background = backgrounds[0];
  const isDark = background ? background.oklch.l < 0.5 : false;

  const roles: Partial<Record<ColorRole, string>> = {};
  const roleOf = new Map<string, ColorRole[]>();
  const taken = new Set<Cluster>();

  const assign = (cluster: Cluster | undefined, role: ColorRole): Cluster | undefined => {
    if (!cluster || roles[role]) return undefined;
    roles[role] = cluster.hex;
    roleOf.set(cluster.hex, [...(roleOf.get(cluster.hex) ?? []), role]);
    taken.add(cluster);
    return cluster;
  };

  assign(background, 'background');

  // A surface is the panel color cards sit on: a second background that is
  // still neutral and still close to the page background. Ranking purely by
  // area would hand this role to a large saturated brand block instead.
  const distinguishable = (c: Cluster) =>
    c !== background && (!background || oklabDistance(c.oklch, background.oklch) > MERGE_DISTANCE * 1.5);
  assign(
    backgrounds.find((c) => distinguishable(c) && c.oklch.c < NEUTRAL_CHROMA) ??
      backgrounds.find(distinguishable),
    'surface',
  );

  // The foreground is the document's inherited text color, which is exactly
  // what <body> computes to. Ranking text colors by area gets this wrong on
  // any page whose secondary copy outweighs its headings.
  const bodyColor = parseColor(nodes.find((n) => n.tag === 'body')?.styles.color ?? '');
  const bodyCluster = bodyColor
    ? clusters.find((c) => oklabDistance(c.oklch, bodyColor.oklch) < MERGE_DISTANCE)
    : undefined;
  const foreground = assign(bodyCluster ?? texts[0], 'foreground');

  // Muted text sits between the background and the foreground in lightness.
  // Requiring it to be *between* them rejects colors that only work on some
  // other section's background — white copy on a dark CTA, for instance.
  //
  // Among the candidates a grey wins over a saturated one: on a text-heavy page
  // links out-measure the one line of secondary copy, and calling the link blue
  // "muted" would send an agent styling every caption in it.
  if (background && foreground) {
    const lo = Math.min(background.oklch.l, foreground.oklch.l);
    const hi = Math.max(background.oklch.l, foreground.oklch.l);
    const between = texts.filter(
      (c) => c !== foreground && c.oklch.l > lo + 0.05 && c.oklch.l < hi - 0.05,
    );
    assign(between.find((c) => c.oklch.c < NEUTRAL_CHROMA) ?? between[0], 'muted');
  }

  // Primary is the chromatic color the site spends on buttons and links.
  // Ranking by interactive area first finds the brand color even when it only
  // appears on a handful of small controls; chroma * area is the fallback for
  // sites whose brand color shows up as a large block instead.
  const chromatic = clusters.filter((c) => c.oklch.c >= NEUTRAL_CHROMA);
  const byInteractive = [...chromatic].sort((a, b) => b.interactiveArea - a.interactiveArea);
  const primary = assign(
    byInteractive[0]?.interactiveArea
      ? byInteractive[0]
      : [...chromatic].sort((a, b) => b.oklch.c * b.area - a.oklch.c * a.area)[0],
    'primary',
  );

  // An accent has to be a genuinely different hue from the primary, and must
  // not simply be a role already claimed elsewhere.
  assign(
    chromatic.find(
      (c) => !taken.has(c) && (!primary || oklabDistance(c.oklch, primary.oklch) > 0.12),
    ),
    'accent',
  );

  assign(borders.find((c) => !taken.has(c)) ?? borders[0], 'border');

  const tokens: ColorToken[] = clusters.slice(0, 24).map((c) => {
    const assigned = roleOf.get(c.hex) ?? [];
    return {
      name: assigned[0] ?? nameColor(c.oklch),
      hex: c.hex,
      rgb: c.rgb,
      alpha: c.alpha,
      oklch: c.oklch,
      area: Math.round(c.area),
      count: c.count,
      roles: assigned.length ? assigned : (['neutral'] as ColorRole[]),
      properties: [...c.propertyAreas.keys()],
    };
  });

  return { tokens, roles, isDark };
}
