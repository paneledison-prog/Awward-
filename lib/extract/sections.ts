import type {
  CtaSpec,
  HarvestNode,
  HarvestResult,
  SectionKind,
  SectionLayout,
  SectionSpec,
} from '../types';
import { NodeTree } from './tree';
import { classifyImage } from './assets';
import { columnCount, detectRepeat, findLayoutContainer } from './components';

/** A candidate must be at least this tall to be a section rather than a rule. */
const MIN_SECTION_HEIGHT = 60;
/** ...and must span this share of the viewport width. */
const MIN_WIDTH_RATIO = 0.55;

const PRICE_RE = /(?:[$£€¥]\s?\d|\d+\s?(?:\/|per\s)\s?(?:mo|month|yr|year|seat|user))/i;
const QUOTE_RE = /[“”"„«»]/;

/**
 * Unwrap the layout shell to find the element whose children are the sections.
 *
 * Frameworks nest the real content inside `#__next` > `div` > `main` and so on.
 * Treating body's single child as the page would yield exactly one "section"
 * containing everything, so the wrapper chain is walked through first.
 */
function findContentRoot(tree: NodeTree): HarvestNode {
  let current = tree.root() ?? tree.nodes[0];

  for (let depth = 0; depth < 6; depth++) {
    const children = tree.children(current.i).filter((c) => c.area > 0);
    // A single child that fills its parent is a wrapper, not a section.
    const soleChild = children.length === 1 ? children[0] : undefined;
    if (soleChild && soleChild.area > current.area * 0.85) {
      current = soleChild;
      continue;
    }
    // <main> holds the page's sections even when it has siblings.
    const main = children.find((c) => c.tag === 'main');
    if (main && tree.children(main.i).length >= 2) {
      current = main;
      continue;
    }
    break;
  }

  return current;
}

interface Candidates {
  nodes: HarvestNode[];
  /**
   * True when the page had no section-shaped children and the whole content
   * root is standing in as a single section.
   */
  wholePage: boolean;
}

function collectCandidates(tree: NodeTree, viewportWidth: number): Candidates {
  const root = findContentRoot(tree);
  const minWidth = viewportWidth * MIN_WIDTH_RATIO;

  const candidates = tree
    .children(root.i)
    .filter((c) => c.box[3] >= MIN_SECTION_HEIGHT && c.box[2] >= minWidth);

  // A <main> reached through the wrapper chain hides the site's own header and
  // footer, which are siblings of it and are still part of the page.
  const bodyChildren = tree.children((tree.root() ?? tree.nodes[0]).i);
  const chrome = bodyChildren.filter(
    (c) =>
      (c.tag === 'header' || c.tag === 'nav' || c.tag === 'footer') &&
      !candidates.some((s) => s.i === c.i) &&
      c.box[3] >= 24,
  );

  const all = [...candidates, ...chrome].sort((a, b) => a.box[1] - b.box[1] || a.i - b.i);

  // An article or docs page is a run of headings and paragraphs directly under
  // <body>, none of them tall enough to look like a section. Returning nothing
  // there would report a page with no content at all, so the content root
  // itself becomes the single section.
  if (all.length === 0) return { nodes: [root], wholePage: true };

  return { nodes: all, wholePage: false };
}

interface SectionContext {
  node: HarvestNode;
  tree: NodeTree;
  descendants: HarvestNode[];
  text: string;
  order: number;
  total: number;
  hasH1: boolean;
  repeatCount: number;
  repeatIsImages: boolean;
}

/**
 * Classify a section by what it contains.
 *
 * Order matters: the checks run from most specific evidence (a price, a
 * blockquote) to least (a heading and a button), so a pricing block is never
 * downgraded to a generic card grid just because it also has three columns.
 */
function classify(ctx: SectionContext): SectionKind {
  const { node, descendants, text, order, total, hasH1, repeatCount, repeatIsImages } = ctx;
  const tag = node.tag;
  const y = node.box[1];
  const links = descendants.filter((d) => d.tag === 'a').length;

  if (tag === 'footer') return 'footer';
  if (tag === 'nav' || node.role === 'navigation') return 'nav';
  if (tag === 'header' && y < 200 && node.box[3] < 200) return 'nav';
  // A short strip of links pinned to the top is a nav bar whatever its tag.
  if (y < 160 && node.box[3] <= 120 && links >= 3) return 'nav';
  // A dense block of links at the very bottom is a footer whatever its tag.
  if (order >= total - 1 && links >= 6) return 'footer';

  if (hasH1) return 'hero';

  if (PRICE_RE.test(text) && repeatCount >= 2 && repeatCount <= 5) return 'pricing';
  if (descendants.some((d) => d.tag === 'blockquote') || (QUOTE_RE.test(text) && repeatCount <= 3)) {
    return 'testimonial';
  }
  if (descendants.some((d) => d.tag === 'details' || d.tag === 'summary')) return 'faq';
  if (repeatIsImages && repeatCount >= 3) return 'logo-cloud';

  if (repeatCount >= 3) {
    // Numbers with no prose around them are a stats strip, not features.
    const statLike =
      /\d[\d,.]*\s*(%|\+|k|m|x)\b/i.test(text) && text.replace(/[^a-z]/gi, '').length < 240;
    if (statLike && repeatCount <= 5) return 'stats';
    const imageHeavy = descendants.filter((d) => d.img).length >= repeatCount;
    return imageHeavy ? 'gallery' : 'feature-grid';
  }

  if (descendants.some((d) => d.tag === 'form' || d.tag === 'input')) return 'cta';
  // A short block whose only job is a heading and a button is a call to action.
  const buttons = descendants.filter(
    (d) => d.tag === 'button' || (d.tag === 'a' && d.styles.backgroundColor !== 'rgba(0, 0, 0, 0)'),
  ).length;
  if (buttons >= 1 && node.box[3] < 520 && links <= 4) return 'cta';

  return 'content';
}

const LABELS: Record<SectionKind, string> = {
  nav: 'Navigation',
  hero: 'Hero',
  'feature-grid': 'Feature grid',
  'logo-cloud': 'Logo cloud',
  testimonial: 'Testimonial',
  pricing: 'Pricing',
  faq: 'FAQ',
  stats: 'Stats',
  gallery: 'Gallery',
  cta: 'Call to action',
  content: 'Content',
  footer: 'Footer',
};

const COMPONENT_NAMES: Partial<Record<SectionKind, string>> = {
  'feature-grid': 'FeatureCard',
  pricing: 'PricingTier',
  testimonial: 'TestimonialCard',
  'logo-cloud': 'LogoMark',
  stats: 'StatItem',
  faq: 'FaqItem',
  gallery: 'GalleryItem',
};

function isButtonLike(node: HarvestNode): boolean {
  if (node.tag === 'button' || node.role === 'button') return true;
  if (node.tag !== 'a') return false;
  const hasFill = node.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && node.styles.backgroundColor !== 'transparent';
  return hasFill || node.hasBorder || /\b(btn|button|cta)\b/i.test(node.cls);
}

function describeCta(node: HarvestNode): CtaSpec {
  const filled =
    node.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    node.styles.backgroundColor !== 'transparent';
  return {
    label: node.subtreeText.slice(0, 80),
    href: node.href,
    variant: filled ? 'primary' : node.hasBorder ? 'secondary' : 'link',
    background: node.styles.backgroundColor,
    color: node.styles.color,
    radius: node.styles.borderTopLeftRadius,
    paddingX: Math.round(parseFloat(node.styles.paddingLeft) || 0),
    paddingY: Math.round(parseFloat(node.styles.paddingTop) || 0),
  };
}

/**
 * Find the width the section's content is actually constrained to.
 *
 * The centring wrapper is usually a plain block, so the flex/grid element that
 * governs the columns is a different node and reports no max-width at all.
 * Reading only that one leaves every section unbounded, and a rebuild ends up
 * full-bleed.
 */
function findContentWrapper(tree: NodeTree, sectionIndex: number): HarvestNode | null {
  const section = tree.get(sectionIndex);
  if (!section) return null;

  const candidates = [section, ...tree.descendants(sectionIndex, 300)]
    .map((node) => ({ node, maxWidth: parseFloat(node.styles.maxWidth) }))
    .filter(
      (c) =>
        Number.isFinite(c.maxWidth) &&
        c.maxWidth >= 480 &&
        c.maxWidth <= 2200 &&
        // The wrapper spans the section; a max-width on a narrow lede does not
        // describe the container.
        c.node.box[2] >= Math.min(section.box[2], c.maxWidth) * 0.8,
    )
    .sort((a, b) => b.node.area - a.node.area);

  return candidates[0]?.node ?? null;
}

function buildLayout(
  container: HarvestNode,
  tree: NodeTree,
  section: HarvestNode,
): SectionLayout {
  const wrapper = findContentWrapper(tree, section.i);
  // Horizontal padding almost always lives on the centring wrapper rather than
  // the section shell, so reading the shell reports 0 and a rebuild puts text
  // flush against the viewport edge on mobile.
  const sectionPaddingX = Math.round(parseFloat(section.styles.paddingLeft) || 0);
  const wrapperPaddingX = Math.round(parseFloat(wrapper?.styles.paddingLeft ?? '0') || 0);

  return {
    display: container.styles.display,
    flexDirection: container.styles.flexDirection,
    justifyContent: container.styles.justifyContent,
    alignItems: container.styles.alignItems,
    gap: Math.round(parseFloat(container.styles.gap) || 0),
    gridTemplateColumns: container.styles.gridTemplateColumns,
    columns: columnCount(container, tree),
    maxWidth: wrapper ? Math.round(parseFloat(wrapper.styles.maxWidth)) : null,
    paddingTop: Math.round(parseFloat(section.styles.paddingTop) || 0),
    paddingBottom: Math.round(parseFloat(section.styles.paddingBottom) || 0),
    paddingX: sectionPaddingX || wrapperPaddingX,
    textAlign: container.styles.textAlign,
    minHeight: Math.round(section.box[3]),
  };
}

/**
 * Build one section from an arbitrary node.
 *
 * Split out of `buildSections` so a single element can be described through the
 * same code path a whole-page section goes through: component extraction then
 * comes down to choosing the node, not to a second implementation that drifts.
 */
export function buildSectionSpec(
  tree: NodeTree,
  node: HarvestNode,
  ctx: {
    order: number;
    total: number;
    /** Skip classification — a whole page standing in as one section is an
     *  article, not a hero: its <h1> is the document title. */
    forceKind?: SectionKind;
    id?: string;
  },
): SectionSpec {
  const descendants = tree.descendants(node.i);
  const text = node.subtreeText;

  const layoutContainer = findLayoutContainer(tree, node.i);
  const provisionalRepeat = detectRepeat(tree, layoutContainer.i, 'Item');
  const repeatIsImages =
    provisionalRepeat !== undefined &&
    provisionalRepeat.items.filter((item) => item.image).length >= provisionalRepeat.count - 1;

  const kind: SectionKind =
    ctx.forceKind ??
    classify({
        node,
        tree,
        descendants,
        text,
        order: ctx.order,
        total: ctx.total,
        hasH1: descendants.some((d) => d.tag === 'h1' && d.text),
        repeatCount: provisionalRepeat?.count ?? 0,
        repeatIsImages,
      });

  // Nav and footer link lists are not "components"; naming them as such adds
  // a meaningless <NavItem> to the emitted code.
  const repeat =
    kind === 'nav' || kind === 'footer'
      ? undefined
      : provisionalRepeat
        ? { ...provisionalRepeat, componentName: COMPONENT_NAMES[kind] ?? 'Item' }
        : undefined;

  const isChrome = kind === 'nav' || kind === 'footer';
  const headingNode = isChrome
    ? undefined
    : ['h1', 'h2', 'h3', 'h4']
        .map((tag) => descendants.find((d) => d.tag === tag && d.text))
        .find(Boolean);

  // The eyebrow is the small, often uppercase label sitting above the
  // heading — a distinct design element that reads wrong if folded into body.
  const eyebrow = descendants.find(
    (d) =>
      d.text &&
      headingNode !== undefined &&
      d.box[1] < headingNode.box[1] &&
      d.text.length < 60 &&
      (d.styles.textTransform === 'uppercase' ||
        (parseFloat(d.styles.fontSize) || 16) < 15),
  );

  const paragraphs = descendants.filter(
    (d) => d.text && d.text.length > 24 && d !== headingNode && d !== eyebrow,
  );

  // Content already reported inside repeat items would otherwise appear twice.
  const repeatText = new Set(repeat?.items.flatMap((item) => item.lines) ?? []);
  const bodyText = paragraphs
    .map((p) => p.text)
    .filter((line) => !repeatText.has(line))
    .slice(0, 8);

  const ctas = descendants
    .filter(isButtonLike)
    .filter((d) => d.subtreeText.trim().length > 0 && !repeatText.has(d.subtreeText))
    .slice(0, 6)
    .map(describeCta);

  const navLinks =
    kind === 'nav' || kind === 'footer'
      ? descendants
          .filter((d) => d.tag === 'a' && d.subtreeText.trim())
          .slice(0, 40)
          .map((d) => ({ label: d.subtreeText.slice(0, 40), href: d.href }))
      : [];

  const images = descendants
    .filter((d) => d.img?.src)
    .slice(0, 20)
    .map(classifyImage)
    // Shape alone cannot tell a customer logo from a photo, but a logo cloud
    // says outright what its images are — and these are exactly the assets a
    // rebuild must not reuse.
    .map((image) =>
      kind === 'logo-cloud' ? { ...image, role: 'logo' as const, isBrandAsset: true } : image,
    );

  const notes: string[] = [];
  if (node.styles.position === 'sticky' || node.styles.position === 'fixed') {
    notes.push(`Pinned to the viewport (position: ${node.styles.position}).`);
  }
  if (node.styles.backdropFilter && node.styles.backdropFilter !== 'none') {
    notes.push(`Backdrop filter: ${node.styles.backdropFilter}.`);
  }
  if (node.styles.backgroundImage.includes('gradient')) {
    notes.push(`Background gradient: ${node.styles.backgroundImage.slice(0, 160)}.`);
  }
  if (repeat) {
    notes.push(
      `${repeat.count} repeating items in ${repeat.columns} column(s) — emit one ${repeat.componentName} and map over the data.`,
    );
  }

  const subheadingNode = paragraphs.find(
    (p) => headingNode !== undefined && p.box[1] >= headingNode.box[1],
  );

  return {
    id: ctx.id ?? `section-${ctx.order + 1}-${kind}`,
    kind,
    label: LABELS[kind],
    order: ctx.order,
    selector: node.sel,
    box: node.box,
    background: node.styles.backgroundColor,
    backgroundImage:
      node.styles.backgroundImage === 'none' ? '' : node.styles.backgroundImage.slice(0, 300),
    textColor: node.styles.color,
    layout: buildLayout(layoutContainer, tree, node),
    eyebrow: eyebrow?.text ?? '',
    heading: headingNode?.text ?? '',
    headingLevel: headingNode ? Number(headingNode.tag.slice(1)) || 0 : 0,
    subheading: subheadingNode && subheadingNode.text !== bodyText[0] ? subheadingNode.text : bodyText[0] ?? '',
    bodyText,
    ctas,
    navLinks,
    images,
    repeat,
    responsive: {},
    notes,
  };
}

export function buildSections(harvest: HarvestResult): SectionSpec[] {
  const tree = new NodeTree(harvest.nodes);
  const { nodes: candidates, wholePage } = collectCandidates(tree, harvest.viewport.width);

  return candidates.map((node, order) =>
    buildSectionSpec(tree, node, {
      order,
      total: candidates.length,
      forceKind: wholePage ? 'content' : undefined,
    }),
  );
}
