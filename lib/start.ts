import { runExtraction } from './extract';
import { createJob, emitProgress, failJob, finishJob, getFinishedJob, getJob } from './jobs';
import type { ExtractOptions, Job } from './types';

/**
 * Start an extraction and return its job immediately.
 *
 * Deliberately not awaited: an extraction runs for tens of seconds, and both
 * callers — the browser over SSE and an agent over MCP — poll for the result
 * rather than holding a request open past every intermediate proxy timeout.
 */
export function startExtraction(options: ExtractOptions): Job {
  const job = createJob(options);

  void runExtraction(job.id, options, (step, message, progress) =>
    emitProgress(job.id, step, message, progress),
  )
    .then((result) => finishJob(job.id, result))
    .catch((error: unknown) => {
      failJob(job.id, error instanceof Error ? error.message : String(error));
    });

  return job;
}

/**
 * Wait for a job to finish, up to `timeoutMs`.
 *
 * Returns the job whatever state it is in, so a caller that runs out of
 * patience still gets the progress so far rather than an error.
 */
export async function waitForJob(id: string, timeoutMs: number): Promise<Job | undefined> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const job = getJob(id) ?? (await getFinishedJob(id));
    if (!job || job.status === 'done' || job.status === 'error') return job;
    if (Date.now() >= deadline) return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
