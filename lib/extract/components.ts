import type { HarvestNode, ImageSpec, RepeatItem, RepeatSpec } from '../types';
import { NodeTree, textLines } from './tree';
import { classifyImage } from './assets';

/** Minimum siblings sharing a signature before it counts as a component. */
const MIN_REPEAT = 3;
/** Share of a container's children the group must cover. */
const MIN_COVERAGE = 0.6;

/**
 * Find a repeating child component inside a container.
 *
 * This is the difference between output an agent can build and output it has to
 * transcribe: six sibling cards emitted as six hand-written divs is unusable,
 * whereas one `<Card>` plus a six-item data array is exactly what a developer
 * would have written in the first place.
 */
export function detectRepeat(
  tree: NodeTree,
  containerIndex: number,
  componentName: string,
): RepeatSpec | undefined {
  const children = tree.children(containerIndex).filter((c) => c.area > 0);
  if (children.length < MIN_REPEAT) return undefined;

  const bySignature = new Map<string, HarvestNode[]>();
  for (const child of children) {
    const group = bySignature.get(child.sig) ?? [];
    group.push(child);
    bySignature.set(child.sig, group);
  }

  const [signature, group] =
    [...bySignature.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!group || group.length < MIN_REPEAT) return undefined;
  if (group.length / children.length < MIN_COVERAGE) return undefined;

  const container = tree.get(containerIndex);
  const first = group[0];

  return {
    count: group.length,
    signature,
    columns: countColumns(group),
    gap: parseFloat(container?.styles.gap ?? '0') || 0,
    itemLayout: {
      display: first.styles.display,
      padding: shorthand(first, 'padding'),
      background: first.styles.backgroundColor,
      radius: first.styles.borderTopLeftRadius,
      border: first.hasBorder
        ? `${first.styles.borderTopWidth} ${first.styles.borderStyle} ${first.styles.borderTopColor}`
        : 'none',
      shadow: first.styles.boxShadow === 'none' ? '' : first.styles.boxShadow,
    },
    items: group.slice(0, 12).map((node) => describeItem(tree, node)),
    componentName,
  };
}

/** Items sharing a top edge are one row, so that row's size is the column count. */
function countColumns(group: HarvestNode[]): number {
  if (group.length === 0) return 0;
  const firstRowTop = group[0].box[1];
  const columns = group.filter((n) => Math.abs(n.box[1] - firstRowTop) < 12).length;
  return Math.max(1, columns);
}

function shorthand(node: HarvestNode, prop: 'padding'): string {
  const s = node.styles;
  const top = s[`${prop}Top` as const];
  const right = s[`${prop}Right` as const];
  const bottom = s[`${prop}Bottom` as const];
  const left = s[`${prop}Left` as const];
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && left === right) return `${top} ${right}`;
  return `${top} ${right} ${bottom} ${left}`;
}

function describeItem(tree: NodeTree, node: HarvestNode): RepeatItem {
  const lines = textLines(tree, node.i, 12);
  const descendants = tree.descendants(node.i);

  // The heading is a real heading tag when there is one, otherwise the largest
  // text in the item — which is how a reader would identify it too.
  const headingNode =
    descendants.find((d) => /^h[1-6]$/.test(d.tag) && d.text) ??
    [...descendants]
      .filter((d) => d.text)
      .sort(
        (a, b) => (parseFloat(b.styles.fontSize) || 0) - (parseFloat(a.styles.fontSize) || 0),
      )[0];

  const heading = headingNode?.text ?? lines[0] ?? '';
  const body = lines.find((line) => line !== heading && line.length > 20) ?? '';

  // The item may itself be the image — a logo cloud repeats bare <img>
  // elements, whose descendants contain nothing at all.
  const imageNode = node.img?.src ? node : descendants.find((d) => d.img?.src);
  const link = node.href || descendants.find((d) => d.href)?.href || '';

  return {
    lines,
    heading,
    body,
    image: imageNode?.img ? classifyImage(imageNode) : undefined,
    href: link,
    hasIcon: descendants.some((d) => d.svg),
  };
}

/**
 * Locate the element that actually lays a section out.
 *
 * A `<section>` is usually only a padding shell; the grid or flex row that
 * decides the columns sits one or two levels down, and reading the shell's
 * styles reports `display: block` for a three-column grid.
 */
export function findLayoutContainer(tree: NodeTree, sectionIndex: number): HarvestNode {
  const section = tree.get(sectionIndex)!;
  const candidates = tree
    .descendants(sectionIndex, 400)
    .filter(
      (d) =>
        (d.styles.display.includes('grid') || d.styles.display.includes('flex')) &&
        d.childCount >= 2 &&
        d.area > section.area * 0.15,
    )
    .sort((a, b) => b.area - a.area);

  return candidates[0] ?? section;
}

/** Grid template columns is authoritative; otherwise infer from the first row. */
export function columnCount(node: HarvestNode, tree: NodeTree): number {
  const template = node.styles.gridTemplateColumns;
  if (template && template !== 'none') {
    const tracks = template.trim().split(/\s+/).filter(Boolean).length;
    if (tracks > 0) return tracks;
  }
  const children = tree.children(node.i).filter((c) => c.area > 0);
  if (children.length === 0) return 1;
  if (!node.styles.display.includes('flex')) return 1;
  return countColumns(children);
}

export type { ImageSpec };
