import { randomUUID } from 'node:crypto';
import type { ExtractOptions, ExtractionResult, Job, JobEvent } from './types';

const TTL_MS = Number(process.env.JOB_TTL_MS ?? 30 * 60 * 1000);
const SWEEP_MS = 60_000;

type Listener = (event: JobEvent | { done: true }) => void;

/**
 * Jobs live in memory only. A single self-hosted server is the target
 * deployment, and results are downloaded rather than persisted, so a Map with
 * a TTL avoids a database without losing anything the product needs.
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
  }, SWEEP_MS);
  // Never hold the process open just to sweep an empty map.
  store.sweeper.unref?.();
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
