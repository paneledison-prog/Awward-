# DesignDNA

Enter a website. Get its design system measured, its layout mapped, and a brief
you can paste straight into an AI coding agent to rebuild it.

```
URL or name  →  headless Chromium  →  computed styles  →  design system
                                                       →  section structure
                                                       →  tokens · React · HTML · agent brief
```

## Why it works this way

Saving a page's HTML and CSS produces something no agent can build from. Modern
pages are JS-rendered, so a plain `fetch` returns an empty `<div id="root">`, and
their stylesheets are megabytes of minified rules behind hashed class names.

So DesignDNA renders the page in a real browser, reads `getComputedStyle` off
every visible element, and works backwards to the design system that produced
those numbers. What comes out is a specification — tokens, layout, content,
assets, screenshots — which is the thing an agent can actually act on.

## What it extracts

**Design system**

| | |
|---|---|
| Colors | Clustered in OKLCH and weighted by rendered area, then assigned roles: `background`, `surface`, `foreground`, `muted`, `primary`, `accent`, `border`. Dark mode captured separately when the site supports it. |
| Typography | Families with their real source and import code, plus a named scale (`h1`, `body`, `small`…) with size, weight, line height and letter spacing. |
| Spacing | The base grid unit, inferred by testing candidates against every measured value, with a confidence score. |
| Effects | Border radii, shadows, border widths, transition durations and easings, keyframe names. |
| Layout | Container max-width, horizontal padding, and the breakpoints declared in the page's own media queries. |

**Structure** — the page is segmented into sections (`nav`, `hero`, `feature-grid`,
`logo-cloud`, `testimonial`, `pricing`, `faq`, `stats`, `cta`, `footer`, `content`),
each with its layout, content, buttons and per-viewport behavior. Repeating sibling
groups are detected and emitted as a single component plus a data array, rather than
six copies of the same markup.

**Assets** — font sources with ready-to-paste import code, an image manifest with
inferred roles, icon-library fingerprinting, and full-page screenshots at every viewport.

## Output

| File | What it is |
|---|---|
| **`AGENT_PROMPT.md`** | **The point of the tool.** Complete build brief: design system, every section, assets, build instructions, acceptance criteria. |
| `AGENT_PROMPT.compact.md` | The same brief trimmed for small context windows. |
| `design-tokens.json` | The design system, machine-readable. |
| `tokens.css` | The same tokens as CSS custom properties. |
| `tailwind.config.js` / `theme.css` | Tailwind v3 and v4 theme configs. |
| `components/*.tsx`, `app/page.tsx` | React + Tailwind rebuild, one component per section. |
| `index.html`, `styles.css` | Framework-free rebuild. |
| `spec.json` | The full extraction. |
| `screenshots/` | Full-page renders at each viewport. |

Everything downloads as one ZIP.

## Running it

### Docker

```bash
docker compose up --build
# http://localhost:3000
```

### Local

Requires Node 22+.

```bash
npm install
npx playwright install chromium   # only if Playwright has no browser yet
npm run dev
```

### Configuration

All optional — see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port. |
| `EXTRACT_TIMEOUT_MS` | `60000` | Per-page render budget. |
| `JOB_TTL_MS` | `1800000` | How long finished results stay in memory. |
| `SCREENSHOT_DIR` | `.screenshots` | Where full-page renders are written. Must be outside `public/`. |
| `CHROMIUM_EXECUTABLE_PATH` | — | Explicit Chromium path, when Playwright's own copy is not the one you want. |
| `HTTPS_PROXY` | — | Routes the browser through a proxy. |
| `DEV_INSECURE_TLS` | — | **Development only.** Accepts a dev proxy's MITM certificate. Never set in production. |

## Development

```bash
npm test              # 25 inference tests, no browser required
npm run build         # production build
npm run typecheck
npm run fixtures      # serve test/fixtures on :4321
npm run smoke         # extract all three fixtures end to end
npm run record-fixture # re-record the harvest the tests run against
```

Tests run against a recorded harvest in `test/fixtures/`. That is deliberate:
the browser step produces one flat array of nodes, and every inference after it
is a pure function of that array, so the analysis is testable without Chromium.

Three fixture pages under `test/fixtures/` exercise the range — a token-driven
light marketing page, a dark product site, and a plain article with almost no
design system. `npm run fixtures` serves them on `:4321`; `npm run smoke` runs a
full extraction against all three and prints what each one inferred.

## How the pipeline fits together

```
lib/browser.ts          launch Chromium, load the page, scroll it, screenshot
lib/extract/harvest.ts  runs INSIDE the page: walks the DOM, records ~50 computed
                        styles + geometry + text per element → one flat array
lib/extract/colors.ts       ─┐
lib/extract/typography.ts    │  pure functions over that array
lib/extract/spacing.ts       ├─ → DesignSystem
lib/extract/effects.ts      ─┘
lib/extract/sections.ts      segment + classify sections
lib/extract/components.ts    detect repeating sibling groups
lib/emit/*                   tokens · React · HTML · agent brief · ZIP
```

## Scope and conduct

DesignDNA fetches `robots.txt` and refuses paths the site disallows. It extracts
one page per run, identifies itself in its User-Agent, does not touch
authenticated or paywalled pages, and does not rehost images — they are
referenced at their original URLs.

The design system it measures is yours to build on. The copy, photography and
logos are not: they belong to the source site. Brand assets are flagged in every
brief, and switching content mode to **placeholder** gives you the same structure
with stand-in text of matching length, so the layout holds while you write your own.

## Known limits

- One page per extraction; multi-page crawling is not implemented.
- Interaction-gated content (closed tabs, accordions, modals) is not captured.
- JavaScript behavior is not extracted — only the transition timings the CSS declares.
- Cross-origin stylesheets cannot be read directly. Their rendered effect is still
  captured through computed styles, but media queries declared only inside them are
  missed; the brief warns when this happens.
- Very large pages are analyzed up to a 3,000-element cap, reported as a warning.
