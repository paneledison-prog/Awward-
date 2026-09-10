import { buildSectionSpec } from './sections';
import { NodeTree } from './tree';
import type { HarvestResult, SectionSpec } from '../types';

/**
 * The one section of a harvest that was scoped to a single element.
 *
 * `buildSections` is the wrong entry point here: it hunts for page-sized
 * candidates, and a 380px-wide card fails its width gate, so the whole
 * component would come back classified as generic "content". Naming the node
 * directly lets the same classifier read it as the pricing card it is.
 */
export function buildComponentSection(harvest: HarvestResult): SectionSpec {
  const tree = new NodeTree(harvest.nodes);
  const root = tree.root() ?? harvest.nodes[0];
  if (!root) throw new Error('The element produced no measurable content.');

  const spec = buildSectionSpec(tree, root, { order: 0, total: 1, id: 'component-1' });

  // The selector the caller asked for beats the generated CSS path: it is what
  // they can paste back into DevTools to check the extraction hit the right
  // element.
  const requested = harvest.root?.selector;
  return requested ? { ...spec, selector: requested } : spec;
}

/**
 * Cut one element's subtree out of a harvest that already covers the page.
 *
 * The scoped harvest is the better path — it measures only what was asked for —
 * but it needs the selector to be known before the page is rendered. When a
 * whole page has already been captured (the extension sending back a manual
 * capture, say), slicing gives the same shape without a second render.
 */
export function sliceSubtree(harvest: HarvestResult, rootIndex: number): HarvestResult {
  const tree = new NodeTree(harvest.nodes);
  const root = tree.get(rootIndex);
  if (!root) throw new Error(`No element at index ${rootIndex}.`);

  const kept = [root, ...tree.descendants(rootIndex)];
  // Indices are positions in the array, so every one of them shifts.
  const remap = new Map(kept.map((node, position) => [node.i, position]));

  const nodes = kept.map((node, position) => ({
    ...node,
    i: position,
    p: node.i === rootIndex ? -1 : (remap.get(node.p) ?? -1),
  }));

  return {
    ...harvest,
    nodes,
    root: { selector: root.sel, found: true, box: root.box },
    stats: { ...harvest.stats, nodeCount: nodes.length },
  };
}

/**
 * Find the element a caller named. Exact CSS paths as recorded by the harvest,
 * `#id` and `.class` are supported; anything more is left to the browser, which
 * resolves the selector itself when the harvest is scoped up front.
 */
export function findNodeIndex(harvest: HarvestResult, selector: string): number {
  const wanted = selector.trim();
  if (!wanted) return -1;

  const exact = harvest.nodes.find((node) => node.sel === wanted);
  if (exact) return exact.i;

  if (wanted.startsWith('#')) {
    const id = wanted.slice(1);
    return harvest.nodes.find((node) => node.id === id)?.i ?? -1;
  }

  if (wanted.startsWith('.')) {
    const className = wanted.slice(1);
    // Largest match wins: a class shared by a card and its inner wrapper should
    // resolve to the card.
    const matches = harvest.nodes
      .filter((node) => node.cls.split(/\s+/).includes(className))
      .sort((a, b) => b.area - a.area);
    return matches[0]?.i ?? -1;
  }

  return -1;
}
