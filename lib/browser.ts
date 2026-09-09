import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { HarvestNetworkEntry, ViewportConfig, ViewportLabel } from './types';

export const VIEWPORTS: Record<ViewportLabel, ViewportConfig> = {
  desktop: { label: 'desktop', width: 1440, height: 900, isMobile: false },
  tablet: { label: 'tablet', width: 768, height: 1024, isMobile: false },
  mobile: { label: 'mobile', width: 390, height: 844, isMobile: true },
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36 DesignDNA/1.0 (+design extraction; respects robots.txt)';

let browserPromise: Promise<Browser> | null = null;

/**
 * Where Chromium lives. Playwright normally finds its own download, but a
 * pinned-version mismatch or a prebuilt image needs an explicit path, so an
 * env var wins and a well-known image location is tried before giving up.
 */
function resolveExecutablePath(): string | undefined {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit) return explicit;
  return undefined;
}

function launchArgs(): string[] {
  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-blink-features=AutomationControlled',
    // Keep animations from settling into a half-finished frame in screenshots.
    '--force-prefers-reduced-motion=0',
  ];
  // Development escape hatch for proxies that re-terminate TLS with a private
  // CA the browser does not trust. Off unless explicitly enabled.
  if (process.env.DEV_INSECURE_TLS === '1') args.push('--ignore-certificate-errors');
  return args;
}

/** One browser process for the lifetime of the server; contexts isolate jobs. */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        executablePath: resolveExecutablePath(),
        args: launchArgs(),
        proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
      })
      .catch((err) => {
        // Reset so a later request can retry instead of latching the failure.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => undefined);
}

export interface PageSession {
  context: BrowserContext;
  page: Page;
  network: HarvestNetworkEntry[];
  close: () => Promise<void>;
}

export async function openPage(
  viewport: ViewportConfig,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<PageSession> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme,
    ignoreHTTPSErrors: process.env.DEV_INSECURE_TLS === '1',
    // A real Accept-Language stops some sites serving a stripped-down page.
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const network: HarvestNetworkEntry[] = [];
  context.on('response', (res) => {
    const headers = res.headers();
    network.push({
      url: res.url(),
      type: headers['content-type'] ?? '',
      status: res.status(),
    });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  return {
    context,
    page,
    network,
    close: async () => {
      await context.close().catch(() => undefined);
    },
  };
}

/**
 * Drive the page to a fully-rendered state.
 *
 * Lazy-loaded images and scroll-triggered animations only exist after the page
 * has actually been scrolled, so a plain `goto` captures a half-built page and
 * every downstream inference inherits the gap.
 */
export async function loadAndSettle(page: Page, url: string, timeoutMs: number): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  // networkidle can never arrive on sites with polling or open sockets, so it
  // is a best-effort improvement rather than a requirement.
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);

  await page.evaluate(async () => {
    const step = Math.max(400, window.innerHeight * 0.8);
    const maxScroll = () =>
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

    for (let y = 0; y < maxScroll() && y < 40_000; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 350));
  });

  // Let fonts swap in before styles are read; a FOUT would poison the type scale.
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(400);
}

export async function screenshot(page: Page, fullPage: boolean): Promise<Buffer> {
  return page.screenshot({ fullPage, type: 'jpeg', quality: 82, scale: 'css' });
}
