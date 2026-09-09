import type { ViewportConfig, ViewportLabel } from './types';

/**
 * The three viewports every extraction captures.
 *
 * Kept out of `lib/browser.ts` so the emitters can state the exact capture
 * width in the brief without importing Playwright to find it out.
 */
export const VIEWPORTS: Record<ViewportLabel, ViewportConfig> = {
  desktop: { label: 'desktop', width: 1440, height: 900, isMobile: false },
  tablet: { label: 'tablet', width: 768, height: 1024, isMobile: false },
  mobile: { label: 'mobile', width: 390, height: 844, isMobile: true },
};
