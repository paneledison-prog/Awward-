import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ExtractOptions, ExtractionResult } from '../lib/types';

// Both modules resolve their directory at import time, so the environment has
// to point at a scratch directory before either is loaded.
const root = mkdtempSync(join(tmpdir(), 'designdna-results-'));
const RESULT_DIR = join(root, 'results');
const SCREENSHOT_DIR = join(root, 'screenshots');
process.env.RESULT_DIR = RESULT_DIR;
process.env.SCREENSHOT_DIR = SCREENSHOT_DIR;
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = () => import('../lib/results');
const screenshots = () => import('../lib/screenshots');

const options: ExtractOptions = {
  url: 'https://example.com',
  contentMode: 'verbatim',
  viewports: ['desktop'],
  emitReact: true,
  emitHtml: true,
};

function resultFor(id: string): ExtractionResult {
  return { id, page: { finalUrl: 'https://example.com/' } } as ExtractionResult;
}

test('a saved result is readable back with its options', async () => {
  const { saveResult, loadResult } = await results();
  const id = 'job-one';
  await saveResult(id, { options, result: resultFor(id) });

  const stored = await loadResult(id);
  assert.equal(stored?.result.id, id);
  assert.equal(stored?.options.url, options.url);
});

test('an unknown id and a traversal attempt both read as missing', async () => {
  const { loadResult } = await results();
  assert.equal(await loadResult('never-written'), null);
  assert.equal(await loadResult('../secret'), null);
});

test('a truncated result file reads as missing rather than throwing', async () => {
  const { loadResult } = await results();
  await mkdir(RESULT_DIR, { recursive: true });
  await writeFile(join(RESULT_DIR, 'partial.json'), '{"options":');
  assert.equal(await loadResult('partial'), null);
});

test('expiry lists only results older than the cutoff', async () => {
  const { saveResult, loadResult, deleteResult, expiredResultIds } = await results();
  const id = 'job-two';
  await saveResult(id, { options, result: resultFor(id) });

  assert.ok(!(await expiredResultIds(Date.now() - 60_000)).includes(id));

  const expired = await expiredResultIds(Date.now() + 60_000);
  assert.ok(expired.includes(id));

  await deleteResult(id);
  assert.equal(await loadResult(id), null);
});

test('sweeping a job deletes its screenshots and leaves other jobs alone', async () => {
  const { writeScreenshot, deleteScreenshotsFor, screenshotName } = await screenshots();
  await writeScreenshot(screenshotName('job-three', 'desktop'), Buffer.from('a'));
  await writeScreenshot(screenshotName('job-three', 'mobile'), Buffer.from('b'));
  await writeScreenshot(screenshotName('job-four', 'desktop'), Buffer.from('c'));

  await deleteScreenshotsFor('job-three');

  assert.deepEqual(await readdir(SCREENSHOT_DIR), ['job-four-desktop.jpg']);
});
