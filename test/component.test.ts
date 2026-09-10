import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { buildPalette } from '../lib/extract/colors';
import { buildComponentSection, findNodeIndex, sliceSubtree } from '../lib/extract/component';
import { buildSections } from '../lib/extract/sections';
import type { HarvestResult } from '../lib/types';

/** The same recorded harvest the inference tests use — no browser needed. */
const harvest: HarvestResult = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/harvest-marketing.json'), 'utf8'),
);

/** The node behind a named section of the fixture page. */
function nodeIndexOfSection(kind: string): number {
  const section = buildSections(harvest).find((s) => s.kind === kind);
  assert.ok(section, `fixture has no ${kind} section`);
  const node = harvest.nodes.find((n) => n.sel === section.selector);
  assert.ok(node, `no node for ${section.selector}`);
  return node.i;
}

test('a sliced subtree keeps only that element and re-indexes it', () => {
  const index = nodeIndexOfSection('pricing');
  const sliced = sliceSubtree(harvest, index);

  assert.ok(sliced.nodes.length > 1);
  assert.ok(sliced.nodes.length < harvest.nodes.length);
  assert.equal(sliced.nodes[0].p, -1, 'the component root has no parent');
  assert.equal(sliced.root?.found, true);
  assert.equal(sliced.stats.nodeCount, sliced.nodes.length);

  // Indices must be positions in the new array, and every parent pointer must
  // resolve inside it — a stale index silently reparents half the tree.
  for (const [position, node] of sliced.nodes.entries()) {
    assert.equal(node.i, position);
    assert.ok(node.p === -1 || (node.p >= 0 && node.p < sliced.nodes.length));
  }
});

test('a component is classified on its own merits, not as page content', () => {
  const sliced = sliceSubtree(harvest, nodeIndexOfSection('pricing'));
  const spec = buildComponentSection(sliced);

  assert.equal(spec.kind, 'pricing');
  assert.equal(spec.order, 0);
  assert.ok(spec.repeat, 'the pricing tiers are a repeating group');
  assert.ok(spec.heading.length > 0);
});

test("a component's palette is its own, not the page's", () => {
  const sliced = sliceSubtree(harvest, nodeIndexOfSection('pricing'));

  const page = buildPalette(harvest.nodes);
  const local = buildPalette(sliced.nodes);

  assert.ok(local.tokens.length > 0);
  assert.ok(
    local.tokens.length < page.tokens.length,
    'a section cannot use more distinct colors than the page it sits in',
  );

  // Every color the component reports must actually appear inside it.
  const own = new Set(
    sliced.nodes.flatMap((n) => [n.styles.color, n.styles.backgroundColor, n.styles.borderTopColor]),
  );
  for (const token of local.tokens) {
    assert.ok(
      [...own].some((value) => value.includes(String(token.rgb[0]))),
      `${token.hex} is not used inside the component`,
    );
  }
});

test('the requested selector is reported back, not the generated CSS path', () => {
  const sliced = sliceSubtree(harvest, nodeIndexOfSection('pricing'));
  sliced.root = { ...sliced.root!, selector: '#pricing' };

  assert.equal(buildComponentSection(sliced).selector, '#pricing');
});

test('selector lookup resolves classes and exact paths, and misses cleanly', () => {
  const hero = harvest.nodes.find((n) => n.cls.split(/\s+/).includes('hero'));
  assert.ok(hero, 'fixture has a .hero element');

  assert.equal(findNodeIndex(harvest, hero.sel), hero.i);
  assert.equal(findNodeIndex(harvest, '.hero'), hero.i);
  assert.equal(findNodeIndex(harvest, '.no-such-class'), -1);
  assert.equal(findNodeIndex(harvest, '#nothing-like-this'), -1);
  assert.equal(findNodeIndex(harvest, '   '), -1);
});

test('a class shared by nested elements resolves to the outermost one', () => {
  // The fixture page has no ids, so the id branch is exercised against a
  // synthetic pair — and the class branch against a real collision.
  const [outer, inner] = [harvest.nodes[1], harvest.nodes[2]];
  const withIds = {
    ...harvest,
    nodes: [
      harvest.nodes[0],
      { ...outer, id: 'card', cls: 'synthetic-card', area: 5000 },
      { ...inner, id: '', cls: 'synthetic-card', area: 100 },
      ...harvest.nodes.slice(3),
    ],
  };

  assert.equal(findNodeIndex(withIds, '#card'), outer.i);
  assert.equal(findNodeIndex(withIds, '.synthetic-card'), outer.i, 'the larger element wins');
});

test('an empty harvest reports that nothing was measured', () => {
  assert.throws(
    () => buildComponentSection({ ...harvest, nodes: [] }),
    /no measurable content/i,
  );
});
