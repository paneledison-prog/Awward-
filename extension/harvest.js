/* GENERATED — do not edit. Run `npm run build:extension`. */
/* Source: lib/extract/harvest.ts */
(() => {
  const harvestFn = function inPageHarvest(options) {
    const maxNodes = options.maxNodes;
    const rootSelector = options.rootSelector ?? '';
    /* ---------------------------------------------------------------- */
    /* Setup                                                             */
    /* ---------------------------------------------------------------- */
    const SKIP_TAGS = new Set([
        'script', 'style', 'noscript', 'template', 'link', 'meta', 'head',
        'title', 'br', 'wbr', 'source', 'track', 'param', 'base',
    ]);
    const STYLE_PROPS = [
        'display', 'position', 'flexDirection', 'flexWrap', 'justifyContent',
        'alignItems', 'gap', 'gridTemplateColumns', 'gridAutoFlow', 'color',
        'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderTopWidth',
        'borderTopStyle', 'borderBottomColor', 'borderBottomWidth', 'borderBottomStyle',
        'borderLeftWidth', 'borderRightWidth',
        'borderTopLeftRadius', 'borderStyle', 'boxShadow', 'opacity', 'fontFamily',
        'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
        'textTransform', 'textAlign', 'textDecorationLine', 'paddingTop',
        'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom',
        'width', 'maxWidth', 'height', 'minHeight', 'transitionDuration',
        'transitionTimingFunction', 'transitionProperty', 'animationName',
        'animationDuration', 'transform', 'fill', 'stroke', 'overflow', 'zIndex',
        'textShadow', 'backdropFilter', 'objectFit',
    ];
    const collapse = (s, max) => s.replace(/\s+/g, ' ').trim().slice(0, max);
    /* ---------------------------------------------------------------- */
    /* Stable selector                                                   */
    /* ---------------------------------------------------------------- */
    function cssPath(el) {
        // A unique id is the shortest stable handle; prefer it and stop.
        if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
            try {
                if (document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
                    return '#' + el.id;
                }
            }
            catch {
                /* fall through to the path form */
            }
        }
        const parts = [];
        let node = el;
        let hops = 0;
        while (node && node.nodeType === 1 && hops < 8) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'html' || tag === 'body') {
                parts.unshift(tag);
                break;
            }
            const parent = node.parentElement;
            if (!parent) {
                parts.unshift(tag);
                break;
            }
            const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
            parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
            node = parent;
            hops++;
        }
        return parts.join(' > ');
    }
    /* ---------------------------------------------------------------- */
    /* Structural signature (drives repeated-component detection)        */
    /* ---------------------------------------------------------------- */
    function signature(el) {
        const tag = el.tagName.toLowerCase();
        const childTags = Array.from(el.children)
            .map((c) => c.tagName.toLowerCase())
            .sort()
            .join(',');
        const hasImg = el.querySelector('img, svg, picture') ? '+m' : '';
        const hasHeading = el.querySelector('h1,h2,h3,h4,h5,h6') ? '+h' : '';
        const hasLink = el.querySelector('a,button') ? '+a' : '';
        // Bucket the descendant count so cards with 7 vs 8 nodes still match.
        const size = el.querySelectorAll('*').length;
        const bucket = size === 0 ? 0 : Math.floor(Math.log2(size + 1));
        return `${tag}[${childTags}]${hasImg}${hasHeading}${hasLink}~${bucket}`;
    }
    /* ---------------------------------------------------------------- */
    /* Own text (direct text-node children only)                         */
    /* ---------------------------------------------------------------- */
    function ownText(el) {
        let out = '';
        for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === 3)
                out += child.nodeValue ?? '';
        }
        return collapse(out, 400);
    }
    /* ---------------------------------------------------------------- */
    /* Walk                                                              */
    /* ---------------------------------------------------------------- */
    const nodes = [];
    let truncated = false;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    function visit(el, parentIndex, depth) {
        if (nodes.length >= maxNodes) {
            truncated = true;
            return;
        }
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag))
            return;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden')
            return;
        // A fully transparent subtree contributes nothing a user can see.
        if (parseFloat(cs.opacity || '1') === 0)
            return;
        const r = el.getBoundingClientRect();
        const width = r.width;
        const height = r.height;
        const area = width * height;
        const childCount = el.children.length;
        // Zero-area elements are kept only as structural parents; a zero-area leaf
        // is invisible and would only add noise to the frequency counts.
        if (area === 0 && childCount === 0)
            return;
        const styles = {};
        for (const prop of STYLE_PROPS) {
            const value = cs[prop];
            styles[prop] = typeof value === 'string' ? value.slice(0, 300) : '';
        }
        const isSvg = tag === 'svg';
        let svg;
        if (isSvg) {
            const paths = el.querySelectorAll('path');
            svg = {
                viewBox: el.getAttribute('viewBox') ?? '',
                pathCount: paths.length,
                firstPathD: (paths[0]?.getAttribute('d') ?? '').slice(0, 200),
                width: Math.round(width),
                height: Math.round(height),
            };
        }
        const index = nodes.length;
        const node = {
            i: index,
            p: parentIndex,
            tag,
            id: el.id ? el.id.slice(0, 80) : '',
            cls: (el.getAttribute('class') ?? '').slice(0, 200),
            role: el.getAttribute('role') ?? '',
            ariaLabel: (el.getAttribute('aria-label') ?? '').slice(0, 120),
            sel: cssPath(el),
            // Document coordinates, so boxes stay comparable after scrolling.
            box: [
                Math.round(r.left + scrollX),
                Math.round(r.top + scrollY),
                Math.round(width),
                Math.round(height),
            ],
            area: Math.round(area),
            depth,
            text: ownText(el),
            subtreeText: collapse(el.textContent ?? '', 600),
            childCount,
            href: el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? '' : '',
            styles,
            hasBorder: parseFloat(cs.borderTopWidth || '0') > 0 ||
                parseFloat(cs.borderBottomWidth || '0') > 0 ||
                parseFloat(cs.borderLeftWidth || '0') > 0 ||
                parseFloat(cs.borderRightWidth || '0') > 0,
            sig: signature(el),
            ...(svg ? { svg } : {}),
        };
        if (el instanceof HTMLImageElement) {
            node.img = {
                src: el.currentSrc || el.src || '',
                alt: (el.getAttribute('alt') ?? '').slice(0, 200),
                naturalWidth: el.naturalWidth,
                naturalHeight: el.naturalHeight,
                isBackground: false,
                loading: el.getAttribute('loading') ?? '',
            };
        }
        else if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            const m = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
            if (m) {
                node.img = {
                    src: m[1],
                    alt: '',
                    naturalWidth: Math.round(width),
                    naturalHeight: Math.round(height),
                    isBackground: true,
                    loading: '',
                };
            }
        }
        nodes.push(node);
        // Individual <path> elements carry no design information worth the cost.
        if (isSvg)
            return;
        for (const child of Array.from(el.children))
            visit(child, index, depth + 1);
    }
    /*
     * Where the walk starts.
     *
     * A selector that matches nothing must be reported, never quietly widened to
     * the body: an agent that asked for `.pricing-card` and received the whole
     * page would describe the wrong thing with complete confidence.
     */
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (root)
        visit(root, -1, 0);
    const rootRect = root?.getBoundingClientRect();
    /* ---------------------------------------------------------------- */
    /* Stylesheets: media queries, keyframes, :root variables            */
    /* ---------------------------------------------------------------- */
    const mediaQueries = new Set();
    const keyframes = new Set();
    const cssVariables = {};
    let ruleCount = 0;
    let inaccessibleSheets = 0;
    function walkRules(rules, depth) {
        if (depth > 4)
            return;
        for (const rule of Array.from(rules)) {
            ruleCount++;
            if (ruleCount > 40_000)
                return;
            const type = rule.constructor?.name ?? '';
            if (type === 'CSSMediaRule' || 'media' in rule) {
                const media = rule.media?.mediaText;
                if (media)
                    mediaQueries.add(media);
            }
            if (type === 'CSSKeyframesRule') {
                const name = rule.name;
                if (name)
                    keyframes.add(name);
            }
            const nested = rule.cssRules;
            if (nested)
                walkRules(nested, depth + 1);
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            const rules = sheet.cssRules;
            if (!rules) {
                inaccessibleSheets++;
                continue;
            }
            walkRules(rules, 0);
        }
        catch {
            // Cross-origin stylesheets throw on access. Count them so the report can
            // say how much of the CSS could not be read.
            inaccessibleSheets++;
        }
    }
    // Custom properties on :root are the site's own design tokens when exposed.
    try {
        const rootStyle = window.getComputedStyle(document.documentElement);
        for (let i = 0; i < rootStyle.length && i < 1200; i++) {
            const prop = rootStyle[i];
            if (prop.startsWith('--')) {
                const value = rootStyle.getPropertyValue(prop).trim().slice(0, 200);
                if (value)
                    cssVariables[prop] = value;
            }
        }
    }
    catch {
        /* custom-property enumeration is best-effort */
    }
    /* ---------------------------------------------------------------- */
    /* Fonts and page metadata                                           */
    /* ---------------------------------------------------------------- */
    const fonts = [];
    try {
        document.fonts?.forEach((f) => {
            if (fonts.length < 60) {
                fonts.push({
                    family: f.family.replace(/^["']|["']$/g, ''),
                    weight: f.weight,
                    style: f.style,
                    status: f.status,
                });
            }
        });
    }
    catch {
        /* FontFaceSet is not enumerable everywhere */
    }
    const metaContent = (selector) => document.querySelector(selector)?.content ?? '';
    const iconHref = document.querySelector('link[rel~="icon"]')?.href ?? '';
    return {
        finalUrl: location.href,
        root: {
            selector: rootSelector,
            found: Boolean(root),
            box: rootRect
                ? [
                    Math.round(rootRect.left + scrollX),
                    Math.round(rootRect.top + scrollY),
                    Math.round(rootRect.width),
                    Math.round(rootRect.height),
                ]
                : [0, 0, 0, 0],
        },
        title: collapse(document.title, 200),
        description: metaContent('meta[name="description"]').slice(0, 400),
        lang: document.documentElement.lang || '',
        documentHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight),
        nodes,
        mediaQueries: Array.from(mediaQueries).slice(0, 200),
        keyframes: Array.from(keyframes).slice(0, 80),
        cssVariables,
        fonts,
        meta: {
            themeColor: metaContent('meta[name="theme-color"]'),
            ogImage: metaContent('meta[property="og:image"]'),
            favicon: iconHref,
            generator: metaContent('meta[name="generator"]'),
        },
        stats: {
            sheetCount: document.styleSheets.length,
            ruleCount,
            inaccessibleSheets,
            nodeCount: nodes.length,
            truncated,
        },
    };
};

  // A selector is planted on the window by the worker just before this runs;
  // a static file injected with `files:` cannot take arguments.
  const rootSelector = globalThis.__designdna_root || '';
  delete globalThis.__designdna_root;

  const raw = harvestFn({ maxNodes: 3000, rootSelector });
  const w = window.innerWidth;
  const label = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';

  const harvest = {
    requestedUrl: location.href,
    ...raw,
    viewport: { width: w, height: window.innerHeight, label },
  };

  const network = performance.getEntriesByType('resource').slice(0, 400).map((e) => ({
    url: e.name,
    type: e.initiatorType || '',
    status: 200,
  }));

  return { harvest, network };
})();
