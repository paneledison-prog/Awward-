import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExtractOptions, ExtractionResult } from './types';

/** Everything needed to rebuild a finished Job after a restart. */
export interface StoredResult {
  options: ExtractOptions;
  result: ExtractionResult;
}

/**
 * Finished results are mirrored to disk.
 *
 * The job store is in memory, and the deployment target scales to zero after a
 * few minutes idle: a user who reads their results and then clicks "Download
 * bundle" hits a process that has restarted and lost every job. The container
 * filesystem survives that restart, and screenshots already live on it, so
 * writing the result next to them keeps a restored result fully usable.
 */
const DIR = resolve(/*turbopackIgnore: true*/ process.env.RESULT_DIR ?? '.results');

/** Job ids are UUIDs; anything else never reaches the filesystem. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

function pathFor(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const path = join(/*turbopackIgnore: true*/ DIR, `${id}.json`);
  if (!resolve(path).startsWith(DIR)) return null;
  return path;
}

export async function saveResult(id: string, stored: StoredResult): Promise<void> {
  const path = pathFor(id);
  if (!path) return;
  await mkdir(/*turbopackIgnore: true*/ DIR, { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path, JSON.stringify(stored));
}

/** Returns null for an unknown id or a file that is not readable JSON. */
export async function loadResult(id: string): Promise<StoredResult | null> {
  const path = pathFor(id);
  if (!path) return null;
  try {
    const stored = JSON.parse(await readFile(/*turbopackIgnore: true*/ path, 'utf8')) as StoredResult;
    return stored?.result ? stored : null;
  } catch {
    return null;
  }
}

export async function deleteResult(id: string): Promise<void> {
  const path = pathFor(id);
  if (!path) return;
  await rm(/*turbopackIgnore: true*/ path, { force: true });
}

/** Ids of results written before `cutoff`. Drives TTL cleanup on disk. */
export async function expiredResultIds(cutoff: number): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(/*turbopackIgnore: true*/ DIR);
  } catch {
    return [];
  }
  const expired: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const info = await stat(join(/*turbopackIgnore: true*/ DIR, entry));
      if (info.mtimeMs < cutoff) expired.push(entry.slice(0, -'.json'.length));
    } catch {
      // Swept by another pass between readdir and stat; nothing to do.
    }
  }
  return expired;
}
