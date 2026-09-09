import type { HarvestNode } from '../types';

/**
 * Navigation over the flat node array.
 *
 * The harvest returns nodes as a flat list with parent indices so it can cross
 * the browser boundary as plain JSON; every structural question downstream
 * needs the tree back, so it is rebuilt once here and shared.
 */
export class NodeTree {
  readonly nodes: HarvestNode[];
  private readonly childIndex: number[][];

  constructor(nodes: HarvestNode[]) {
    this.nodes = nodes;
    this.childIndex = nodes.map(() => []);
    for (const node of nodes) {
      if (node.p >= 0 && node.p < nodes.length) this.childIndex[node.p].push(node.i);
    }
  }

  get(index: number): HarvestNode | undefined {
    return this.nodes[index];
  }

  children(index: number): HarvestNode[] {
    return (this.childIndex[index] ?? []).map((i) => this.nodes[i]);
  }

  /** Depth-first descendants, document order, excluding the node itself. */
  descendants(index: number, limit = 4000): HarvestNode[] {
    const out: HarvestNode[] = [];
    const stack = [...(this.childIndex[index] ?? [])].reverse();
    while (stack.length && out.length < limit) {
      const i = stack.pop()!;
      out.push(this.nodes[i]);
      const kids = this.childIndex[i] ?? [];
      for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
    }
    return out;
  }

  ancestors(index: number): HarvestNode[] {
    const out: HarvestNode[] = [];
    let node = this.nodes[index];
    while (node && node.p >= 0) {
      node = this.nodes[node.p];
      if (node) out.push(node);
    }
    return out;
  }

  root(): HarvestNode | undefined {
    return this.nodes.find((n) => n.p === -1) ?? this.nodes[0];
  }

  /** Concatenated visible text of a subtree, collapsed and capped. */
  text(index: number, max = 2000): string {
    const self = this.nodes[index];
    if (!self) return '';
    return self.subtreeText.slice(0, max);
  }
}

/** Text lines in document order, de-duplicated, skipping inherited repeats. */
export function textLines(tree: NodeTree, index: number, limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const self = tree.get(index);
  if (self?.text) {
    seen.add(self.text);
    out.push(self.text);
  }
  for (const node of tree.descendants(index)) {
    const line = node.text.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}
