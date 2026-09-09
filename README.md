# DesignDNA

[![CI](https://github.com/paneledison-prog/Awward-/actions/workflows/ci.yml/badge.svg)](https://github.com/paneledison-prog/Awward-/actions/workflows/ci.yml)

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

### Deploy

The app needs a container that can run Chromium: **at least 1GB of memory**, and a
platform that allows a long-running process. It will not run on standard
serverless — a request that holds a browser open for 40 seconds is the opposite
of what those are for.

Config is committed for three platforms; each reads the same `Dockerfile`.

**Deploy from GitHub, no local CLI** — Actions → *Deploy to Fly* → Run workflow.
It creates the app, deploys, waits for it to answer, and then extracts a real site
on the live instance to prove it works. Requires one secret:

```bash
fly tokens create org        # paste the output as FLY_API_TOKEN
```

under Settings → Secrets and variables → Actions.

Or deploy from your machine:

| Platform | Command | Notes |
|---|---|---|
| **Fly.io** | `fly launch --copy-config --now` | `fly.toml` sets 1GB and scale-to-zero. Cheapest for bursty use. |
| **Railway** | New Project → Deploy from GitHub repo | Reads `railway.json`. Simplest UI; injects `PORT` itself. |
| **Render** | New → Blueprint → select this repo | Reads `render.yaml`. Needs the Standard plan — free and Starter cap at 512MB and Chromium is OOM-killed. |

After deploying, open the URL and extract something.

**A cold start takes a few seconds.** `fly.toml` scales the machine to zero when
idle, so the first request after a quiet period waits for it to boot. Fly's
dashboard may show "Proxy is having trouble reaching app" during that window,
and Fly Doctor will report the app is not listening — both are describing a
machine that is asleep, not a fault.

To trade cost for latency, set `min_machines_running = 1` in `fly.toml`. The
machine then stays up and answers immediately, and you pay for it around the
clock.

The container image is built and exercised on every push by the `container` job
in CI: it starts the image, runs a full extraction inside it against a local
fixture, and asserts that the screenshots and ZIP actually download. A green badge
means the image really works, not just that it compiled.

The hosting configs themselves (plan names, regions) have not been run against a
live provider account — expect to adjust those.

### Local

Requires Node 22+.

```bash
npm install
npx playwright install chromium   # only if Playwright has no browser yet
npm run dev
```

To open it from a phone on the same network, bind to every interface:

```bash
npm run dev:lan                      # or: npm run build && npm run start:lan
# then http://<your-lan-ip>:3000
```

`npm run dev` and `npm start` listen on localhost only, so a phone cannot reach
them.

`dev:lan` works because `next.config.mjs` sets `allowedDevOrigins` for private
network ranges. Without it, `next dev` treats any origin other than `localhost`
as cross-origin and refuses the HMR WebSocket — and since Turbopack's module
runtime rides on that socket, the page renders and then never hydrates. Every
control is dead, with only a WebSocket error in the console to explain it. That
failure is invisible in production, which does not use HMR at all.

If your browser enforces HTTPS-Only it will refuse a plain `http://` LAN address;
either turn that off or put a tunnel in front
(`cloudflared tunnel --url http://localhost:3000`), which also works over
cellular.

### Configuration

All optional — see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port. |
| `EXTRACT_TIMEOUT_MS` | `60000` | Per-page render budget. |
| `JOB_TTL_MS` | `1800000` | How long a finished result is kept before it is swept from memory and disk. |
| `SCREENSHOT_DIR` | `.screenshots` | Where full-page renders are written. Must be outside `public/`. |
| `RESULT_DIR` | `.results` | Where finished results are mirrored so they survive a restart. |
| `CHROMIUM_EXECUTABLE_PATH` | — | Explicit Chromium path, when Playwright's own copy is not the one you want. |
| `HOSTNAME` / `-H` | `localhost` | `npm run start:lan` binds `0.0.0.0` so other devices on the network can connect. |
| `HTTPS_PROXY` | — | Routes the browser through a proxy. |
| `DEV_INSECURE_TLS` | — | **Development only.** Accepts a dev proxy's MITM certificate. Never set in production. |

## Development

```bash
npm test               # 25 inference tests, no browser required
npm run build          # production build
npm run typecheck
npm run fixtures       # serve test/fixtures on :4321
npm run smoke          # extract all three fixtures end to end
npm run smoke:container # drive a running instance over HTTP (what CI runs)
npm run record-fixture # re-record the harvest the tests run against
```

`smoke:container` takes a base URL, so it checks a local server, a container, or a
deployed instance with the same assertions:

```bash
npm run smoke:container -- https://your-app.fly.dev
```

It is the only check that covers the things unit tests cannot see — whether the
server bound somewhere reachable, and whether files written at runtime are served.

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

## Scaling

Extraction state is in memory. A job created by `POST /api/extract` is visible
only to the process that created it, and the progress stream, the result, the
screenshots and the ZIP must all reach that same process. **Run exactly one
instance.**

A *finished* result is also written to `RESULT_DIR`, so it outlives that
process: the machine can scale to zero while you are reading your results, and
the result page and the ZIP download still work when it wakes up. Screenshots
already live on the same filesystem, so a restored result keeps its images.
Both copies are deleted together once `JOB_TTL_MS` has passed. This does not
make the app multi-instance — an in-flight job still belongs to one process.

On Fly that means pinning `scale count 1` (the deploy workflow does this) and
keeping the concurrency limits well above normal traffic — they count open
connections, and an extraction holds a progress stream open for its whole run,
so a low limit makes Fly start a second machine that answers 404 for every
follow-up request.

Running more than one instance needs the job store moved to something shared —
Redis or Postgres — which is not implemented.

## Sites that block automated browsers

Some sites sit behind bot protection — Cloudflare, DataDome, PerimeterX — and
serve a "verify you are human" interstitial instead of the page. DesignDNA
detects this and fails with a message naming the vendor, rather than extracting
the challenge page and reporting its colours as the site's design system.

Nothing here defeats that check, and there is no setting to bypass it. The
interstitial is the site stating it does not want *automated* access, and that
gets the same treatment as `robots.txt`.

But you are not automated. If you can open the page in your own browser, the
same measurement can run there instead — the block is about where the browser
runs, not what it measures.

### Run it in your own browser

Two ways, both taking the identical code path once the harvest arrives:

**Console snippet** — copy it from the app's front page (or `GET /api/harvest-script`),
paste into DevTools on the page you want, press Enter. It measures the page,
posts the result back, and opens the results tab. No screenshots, and only the
viewport you have open.

**Browser extension** (`extension/`) — click the toolbar button. Same harvest,
plus a screenshot: the visible area, or a full-page capture assembled by
scrolling and compositing, since Chrome gives extensions no full-page API.

Load it unpacked: `chrome://extensions` → Developer mode → Load unpacked →
select `extension/`. Set your instance URL in the popup on first use. It asks
for host permission only for that instance, and uses `activeTab` for the page —
granted per click, not standing access to your browsing.

`extension/harvest.js` is generated from `lib/extract/harvest.ts` by
`npm run build:extension`, so the extension and the server cannot drift apart.
CI fails if the committed copy is stale.

## Known limits

- One page per extraction; multi-page crawling is not implemented.
- Interaction-gated content (closed tabs, accordions, modals) is not captured.
- JavaScript behavior is not extracted — only the transition timings the CSS declares.
- Cross-origin stylesheets cannot be read directly. Their rendered effect is still
  captured through computed styles, but media queries declared only inside them are
  missed; the brief warns when this happens.
- Very large pages are analyzed up to a 3,000-element cap, reported as a warning.
