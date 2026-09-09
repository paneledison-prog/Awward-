import type { HarvestNode, SpacingScale } from '../types';

/** Candidate base units, largest first so the coarsest adequate grid wins. */
const CANDIDATE_UNITS = [8, 6, 4, 2];
/** Share of spacing values a unit must explain before it is claimed as the grid. */
const GRID_THRESHOLD = 0.6;
const MAX_SPACING = 256;

const SPACING_PROPS = [
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginBottom', 'gap',
] as const;

/**
 * Recover the spacing grid a site was designed on.
 *
 * Almost every design system lays out on a base unit, but nothing in the
 * rendered CSS says which one. Testing candidate units against the observed
 * values and keeping the one that explains the most of them recovers it, and
 * the confidence score says how much to trust the answer — a hand-spaced page
 * will score low, which is itself worth reporting.
 */
export function buildSpacingScale(nodes: HarvestNode[]): SpacingScale {
  const counts = new Map<number, number>();

  for (const node of nodes) {
    for (const prop of SPACING_PROPS) {
      const raw = node.styles[prop];
      if (!raw) continue;
      // `gap` can be "16px 24px"; count each axis.
      for (const part of raw.split(/\s+/)) {
        const px = Math.round(parseFloat(part));
        if (!Number.isFinite(px) || px <= 0 || px > MAX_SPACING) continue;
        counts.set(px, (counts.get(px) ?? 0) + 1);
      }
    }
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { baseUnit: 4, confidence: 0, values: [], named: {} };
  }

  // A smaller unit always explains at least as many values as a larger one — 2
  // explains everything even. So the answer is the *coarsest* unit that still
  // explains most of the page, not the one with the best score; otherwise every
  // site is reported as a 2px grid, which is true and useless.
  const ratioFor = (unit: number): number => {
    let explained = 0;
    for (const [value, count] of counts) if (value % unit === 0) explained += count;
    return explained / total;
  };

  let baseUnit = CANDIDATE_UNITS[CANDIDATE_UNITS.length - 1];
  let confidence = ratioFor(baseUnit);
  for (const unit of CANDIDATE_UNITS) {
    const ratio = ratioFor(unit);
    if (ratio >= GRID_THRESHOLD) {
      baseUnit = unit;
      confidence = ratio;
      break;
    }
  }

  // A value used once is a one-off, not a step in the scale.
  const values = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort((a, b) => a - b)
    .slice(0, 20);

  const named: Record<string, number> = {};
  for (const value of values) {
    const steps = value / baseUnit;
    // Tailwind's scale is in 0.25rem units; expressing steps that way makes the
    // emitted config drop straight in.
    const key = Number.isInteger(steps) ? `${(value / 4).toString().replace('.', '_')}` : `px-${value}`;
    named[key] = value;
  }

  return { baseUnit, confidence: Number(confidence.toFixed(3)), values, named };
}
