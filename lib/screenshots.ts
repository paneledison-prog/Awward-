import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Where runtime screenshots live.
 *
 * Deliberately NOT `public/`: Next builds a static manifest of that directory
 * at build time, so anything written there afterwards is served as a 404. These
 * are generated per extraction, so they have to be read back through a route.
 */
const DIR = resolve(/*turbopackIgnore: true*/ process.env.SCREENSHOT_DIR ?? '.screenshots');

/** Only ever a job id, a viewport and a .jpg — nothing that could escape DIR. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}-(desktop|tablet|mobile)\.jpg$/;

export function screenshotName(jobId: string, viewport: string): string {
  return `${jobId}-${viewport}.jpg`;
}

/** The URL the browser fetches. Served by app/api/screenshots/[file]. */
export function screenshotUrl(name: string): string {
  return `/api/screenshots/${name}`;
}

export async function writeScreenshot(name: string, data: Buffer): Promise<void> {
  // These paths are computed at runtime, not bundled. The turbopackIgnore hints
  // tell the bundler so, which stops it tracing the whole project into the build.
  await mkdir(/*turbopackIgnore: true*/ DIR, { recursive: true });
  await writeFile(join(/*turbopackIgnore: true*/ DIR, name), data);
}

/** Returns null for anything that fails the name check or is not on disk. */
export async function readScreenshot(name: string): Promise<Buffer | null> {
  if (!NAME_RE.test(name)) return null;
  try {
    const path = join(/*turbopackIgnore: true*/ DIR, name);
    // Belt and braces: the regex already forbids separators, but a resolved
    // path outside DIR must never be readable regardless.
    if (!resolve(path).startsWith(DIR)) return null;
    return await readFile(/*turbopackIgnore: true*/ path);
  } catch {
    return null;
  }
}

/** Recover the on-disk name from a URL produced by screenshotUrl. */
export function nameFromUrl(url: string): string {
  return url.split('/').pop() ?? '';
}
