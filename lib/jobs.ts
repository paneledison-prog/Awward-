import { randomUUID } from 'node:crypto';
import { deleteResult, expiredResultIds, loadResult, saveResult } from './results';
import { deleteScreenshotsFor } from './screenshots';
import type { ExtractOptions, ExtractionResult, Job, JobEvent } from './types';

const TTL_MS = Number(process.env.JOB_TTL_MS ?? 30 * 60 * 1000);
const SWEEP_MS = 60_000;

type Listener = (event: JobEvent | { done: true }) => void;

/**
 * Jobs live in memory; finished results are additionally mirrored to disk by
 * finishJob. A single self-hosted server is the target deployment, so a Map
 * with a TTL avoids a database — but the process can restart (scale-to-zero
 * after an idle period, a redeploy) while a user is still reading their
 * results, and the disk copy is what makes the download link still work.
 *
 * The store is stashed on globalThis because Next's dev server re-evaluates
 * modules on hot reload, which would otherwise orphan in-flight jobs.
 */
interface Store {
  jobs: Map<string, Job>;
  listeners: Map<string, Set<Listener>>;
  sweeper: NodeJS.Timeout | null;
}

const globalRef = globalThis as unknown as { __designdna_jobs?: Store };

const store: Store =
  globalRef.__designdna_jobs ??
  (globalRef.__designdna_jobs = { jobs: new Map(), listeners: new Map(), sweeper: null });

if (!store.sweeper) {
  store.sweeper = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, job] of store.jobs) {
      const stamp = job.finishedAt ?? job.createdAt;
      if (stamp < cutoff) {
        store.jobs.delete(id);
        store.listeners.delete(id);
      }
    }
    // Disk is swept independently of memory: after a restart the map is empty
    // while the files are not, so iterating the map would never free them.
    void sweepDisk(cutoff);
  }, SWEEP_MS);
  // Never hold the process open just to sweep an empty map.
  store.sweeper.unref?.();
}

async function sweepDisk(cutoff: number): Promise<void> {
  try {
    for (const id of await expiredResultIds(cutoff)) {
      await deleteResult(id);
      await deleteScreenshotsFor(id);
    }
  } catch {
    // A sweep that fails is retried in a minute; it must never crash the server.
  }
}

export function createJob(options: ExtractOptions): Job {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    options,
    events: [],
    createdAt: Date.now(),
  };
  store.jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.jobs.get(id);
}

/**
 * A finished job, restoring it from disk when this process has no memory of it.
 * The restored job carries no event history — only the result, which is all the
 * result and download routes read.
 */
export async function getFinishedJob(id: string): Promise<Job | undefined> {
  const job = store.jobs.get(id);
  if (job) return job;

  const stored = await loadResult(id);
  if (!stored) return undefined;

  const restored: Job = {
    id,
    status: 'done',
    options: stored.options,
    events: [],
    createdAt: Date.now(),
    finishedAt: Date.now(),
    result: stored.result,
  };
  // Put it back in the map so the next request does not re-read the file.
  store.jobs.set(id, restored);
  return restored;
}

export function emitProgress(id: string, step: string, message: string, progress: number): void {
  const job = store.jobs.get(id);
  if (!job) return;
  const event: JobEvent = { step, message, progress, at: Date.now() };
  job.events.push(event);
  job.status = 'running';
  for (const listener of store.listeners.get(id) ?? []) listener(event);
}

export function finishJob(id: string, result: ExtractionResult): void {
  const job = store.jobs.get(id);
  if (!job) return;
  // Mirrored to disk so the result outlives this process. Failing to write is
  // not a failed extraction: the in-memory copy still serves this session.
  void saveResult(id, { options: job.options, result }).catch(() => {});
  job.status = 'done';
  job.result = result;
  job.finishedAt = Date.now();
  const event: JobEvent = { step: 'done', message: 'Extraction complete', progress: 100, at: Date.now() };
  job.events.push(event);
  for (const listener of store.listeners.get(id) ?? []) {
    listener(event);
    listener({ done: true });
  }
}

export function failJob(id: string, error: string): void {
  const job = store.jobs.get(id);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  job.finishedAt = Date.now();
  const event: JobEvent = { step: 'error', message: error, progress: 100, at: Date.now() };
  job.events.push(event);
  for (const listener of store.listeners.get(id) ?? []) {
    listener(event);
    listener({ done: true });
  }
}

/** Subscribe to a job's progress. Replays past events so a late SSE client
 *  still sees the full history. Returns an unsubscribe function. */
export function subscribe(id: string, listener: Listener): () => void {
  const set = store.listeners.get(id) ?? new Set<Listener>();
  set.add(listener);
  store.listeners.set(id, set);

  const job = store.jobs.get(id);
  if (job) {
    for (const event of job.events) listener(event);
    if (job.status === 'done' || job.status === 'error') listener({ done: true });
  }

  return () => {
    set.delete(listener);
    if (set.size === 0) store.listeners.delete(id);
  };
}
