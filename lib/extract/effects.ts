import type {
  ContainerSpec,
  HarvestNode,
  HarvestResult,
  MotionSpec,
  RadiusToken,
  ShadowToken,
} from '../types';

interface Counted {
  value: string;
  count: number;
}

function tally(values: string[], limit: number): Counted[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const RADIUS_NAMES = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'];

export function buildRadii(nodes: HarvestNode[]): RadiusToken[] {
  const raw = nodes
    .map((n) => n.styles.borderTopLeftRadius)
    .filter((v) => v && v !== '0px' && !v.startsWith('0px 0px'));

  const counted = tally(raw, 10)
    // A radius used once is incidental; a scale step recurs.
    .filter((c) => c.count > 1)
    .map((c) => ({ ...c, px: parseFloat(c.value) || 0 }))
    // A pill/circle radius is a shape choice, not a scale step.
    .filter((c) => c.px > 0 && c.px < 100)
    .sort((a, b) => a.px - b.px);

  const tokens: RadiusToken[] = counted.map((c, i) => ({
    name: RADIUS_NAMES[i] ?? `r-${Math.round(c.px)}`,
    value: c.value,
    px: c.px,
    count: c.count,
  }));

  // Pills are worth reporting even though they are not part of the ramp.
  const pill = tally(raw, 20).find((c) => (parseFloat(c.value) || 0) >= 100 || c.value.includes('%'));
  if (pill) tokens.push({ name: 'full', value: pill.value, px: 9999, count: pill.count });

  return tokens;
}

const SHADOW_NAMES = ['sm', 'md', 'lg', 'xl'];

export function buildShadows(nodes: HarvestNode[]): ShadowToken[] {
  const raw = nodes.map((n) => n.styles.boxShadow).filter((v) => v && v !== 'none');
  return tally(raw, 6)
    .filter((c) => c.count > 1)
    // Order by blur radius so the names run light to heavy.
    .sort((a, b) => blurOf(a.value) - blurOf(b.value))
    .map((c, i) => ({ name: SHADOW_NAMES[i] ?? `shadow-${i + 1}`, value: c.value, count: c.count }));
}

function blurOf(shadow: string): number {
  // Third length in a shadow is the blur: "rgba(...) 0px 4px 16px 0px".
  const lengths = shadow.match(/-?\d+(\.\d+)?px/g) ?? [];
  return parseFloat(lengths[2] ?? lengths[1] ?? '0') || 0;
}

export function buildBorderWidths(nodes: HarvestNode[]): Counted[] {
  return tally(
    nodes.filter((n) => n.hasBorder).map((n) => n.styles.borderTopWidth),
    5,
  ).filter((c) => c.count > 1 && parseFloat(c.value) > 0);
}

/**
 * Split a CSS list on top-level commas.
 *
 * An element with two transitions computes to "0.2s, 0.2s", and an easing to
 * "cubic-bezier(0.4, 0, 0.2, 1), ease" — whose own commas must not split it.
 * Reporting either string whole emits a duration token no stylesheet can use.
 */
function splitCssList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function buildMotion(nodes: HarvestNode[], keyframes: string[]): MotionSpec {
  const durations = tally(
    nodes.flatMap((n) => splitCssList(n.styles.transitionDuration)).filter((v) => v && v !== '0s'),
    6,
  );
  const easings = tally(
    nodes
      .flatMap((n) => splitCssList(n.styles.transitionTimingFunction))
      .filter((v) => v && v !== 'ease' && v !== 'linear'),
    6,
  );
  return {
    durations,
    easings,
    keyframes: keyframes.slice(0, 20),
    // A handful of transitions is incidental; widespread use is a design decision.
    usesTransitions: durations.reduce((sum, d) => sum + d.count, 0) > 3,
  };
}

/** Breakpoint widths named by the page's own media queries, ascending. */
export function buildBreakpoints(mediaQueries: string[]): number[] {
  const widths = new Set<number>();
  for (const query of mediaQueries) {
    for (const match of query.matchAll(/\((?:min|max)-width:\s*([\d.]+)(px|em|rem)\)/g)) {
      const value = parseFloat(match[1]);
      if (!Number.isFinite(value)) continue;
      // em/rem in a media query resolve against a 16px root, not the page font.
      const px = match[2] === 'px' ? value : value * 16;
      // A max-width query names the breakpoint one pixel above it.
      const normalized = query.includes('max-width') ? Math.round(px) + 1 : Math.round(px);
      if (normalized >= 240 && normalized <= 2560) widths.add(normalized);
    }
  }
  return [...widths].sort((a, b) => a - b);
}

/**
 * Find the content container width.
 *
 * Sites centre their content in a wrapper with an explicit max-width; that
 * number governs every section's layout, so an agent that misses it produces a
 * page that is right in every detail and wrong at a glance.
 */
export function buildContainer(nodes: HarvestNode[], viewportWidth: number): ContainerSpec {
  const counts = new Map<number, number>();
  const paddings = new Map<number, number>();

  for (const node of nodes) {
    const maxWidth = parseFloat(node.styles.maxWidth);
    if (!Number.isFinite(maxWidth) || maxWidth < 480 || maxWidth > 2200) continue;
    // Only wrappers that actually span the page describe the container.
    if (node.box[2] < Math.min(viewportWidth, maxWidth) * 0.75) continue;
    counts.set(maxWidth, (counts.get(maxWidth) ?? 0) + 1);
    const px = parseFloat(node.styles.paddingLeft) || 0;
    if (px > 0) paddings.set(px, (paddings.get(px) ?? 0) + 1);
  }

  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const bestPadding = [...paddings.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    maxWidth: best ? Math.round(best[0]) : null,
    paddingX: bestPadding ? { desktop: Math.round(bestPadding[0]) } : {},
  };
}

export function readCssVariables(harvest: HarvestResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(harvest.cssVariables)) {
    // Keep the design-relevant half of a site's custom properties and drop the
    // framework bookkeeping that would otherwise swamp the output.
    if (/^--(tw|next|radix|chakra|mui|swiper|headlessui)-/.test(key)) continue;
    out[key] = value;
  }
  return out;
}
