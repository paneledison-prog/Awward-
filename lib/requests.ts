import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CaptureRequest, ViewportLabel } from './types';

/**
 * Captures an agent has asked a human's browser to perform.
 *
 * An agent's own renderer is refused by sites behind a bot check; the person
 * running the extension is not. A request is a note left for them — never a
 * command. Nothing here runs anything: the extension displays pending requests
 * and the person clicks Capture or Dismiss.
 *
 * Stored like results: a map for speed, mirrored to disk so a request survives
 * the machine scaling to zero between the agent asking and the person looking.
 */
const DIR = resolve(/*turbopackIgnore: true*/ process.env.REQUEST_DIR ?? '.requests');
const TTL_MS = Number(process.env.REQUEST_TTL_MS ?? 60 * 60 * 1000);
const MAX_PENDING = 25;

interface Store {
  requests: Map<string, CaptureRequest>;
  loaded: boolean;
}

const globalRef = globalThis as unknown as { __designdna_requests?: Store };
const store: Store =
  globalRef.__designdna_requests ??
  (globalRef.__designdna_requests = { requests: new Map(), loaded: false });

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

function pathFor(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const path = join(/*turbopackIgnore: true*/ DIR, `${id}.json`);
  return resolve(path).startsWith(DIR) ? path : null;
}

async function persist(request: CaptureRequest): Promise<void> {
  const path = pathFor(request.id);
  if (!path) return;
  await mkdir(/*turbopackIgnore: true*/ DIR, { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path, JSON.stringify(request));
}

/** Read the disk copy once per process, then serve from memory. */
async function load(): Promise<void> {
  if (store.loaded) return;
  store.loaded = true;
  try {
    for (const entry of await readdir(/*turbopackIgnore: true*/ DIR)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const request = JSON.parse(
          await readFile(join(/*turbopackIgnore: true*/ DIR, entry), 'utf8'),
        ) as CaptureRequest;
        if (request?.id) store.requests.set(request.id, request);
      } catch {
        // A half-written file is not worth failing the whole listing over.
      }
    }
  } catch {
    // No directory yet: nothing has ever been requested.
  }
}

/** Expire what nobody acted on, in memory and on disk. */
async function sweep(): Promise<void> {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, request] of store.requests) {
    if (request.updatedAt >= cutoff) continue;
    store.requests.delete(id);
    const path = pathFor(id);
    if (path) await rm(/*turbopackIgnore: true*/ path, { force: true });
  }
}

export async function createRequest(input: {
  url: string;
  selector?: string;
  note?: string;
  viewport?: ViewportLabel;
  jobId: string;
}): Promise<CaptureRequest> {
  await load();
  await sweep();

  const pending = [...store.requests.values()].filter((r) => r.status === 'pending');
  if (pending.length >= MAX_PENDING) {
    throw new Error(
      `${pending.length} captures are already waiting in the browser. Ask the person to clear them first.`,
    );
  }

  const now = Date.now();
  const request: CaptureRequest = {
    id: randomUUID(),
    url: input.url,
    selector: input.selector,
    note: input.note,
    viewport: input.viewport,
    jobId: input.jobId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  store.requests.set(request.id, request);
  await persist(request);
  return request;
}

export async function listRequests(status?: CaptureRequest['status']): Promise<CaptureRequest[]> {
  await load();
  await sweep();
  return [...store.requests.values()]
    .filter((request) => !status || request.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRequest(id: string): Promise<CaptureRequest | undefined> {
  await load();
  return store.requests.get(id);
}

export async function updateRequest(
  id: string,
  patch: Partial<Pick<CaptureRequest, 'status' | 'resultId' | 'message'>>,
): Promise<CaptureRequest | undefined> {
  await load();
  const request = store.requests.get(id);
  if (!request) return undefined;

  const updated: CaptureRequest = { ...request, ...patch, updatedAt: Date.now() };
  store.requests.set(id, updated);
  await persist(updated);
  return updated;
}
