import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The module resolves its directory at import time.
process.env.REQUEST_DIR = join(mkdtempSync(join(tmpdir(), 'designdna-requests-')), 'requests');

const queue = () => import('../lib/requests');

test('a queued capture starts pending and carries the job the agent polls', async () => {
  const { createRequest, listRequests } = await queue();

  const request = await createRequest({
    url: 'https://example.com/pricing',
    selector: '.pricing-card',
    note: 'building a pricing page',
    jobId: 'job-1',
  });

  assert.equal(request.status, 'pending');
  assert.equal(request.jobId, 'job-1');

  const pending = await listRequests('pending');
  assert.ok(pending.some((r) => r.id === request.id));
});

test('claiming and completing a capture moves it out of the queue', async () => {
  const { createRequest, listRequests, updateRequest, getRequest } = await queue();

  const request = await createRequest({ url: 'https://example.com', jobId: 'job-2' });

  await updateRequest(request.id, { status: 'claimed' });
  assert.equal((await getRequest(request.id))?.status, 'claimed');
  assert.ok(!(await listRequests('pending')).some((r) => r.id === request.id));

  await updateRequest(request.id, { status: 'done', resultId: 'job-2' });
  const done = await getRequest(request.id);
  assert.equal(done?.status, 'done');
  assert.equal(done?.resultId, 'job-2');
});

test('a declined capture keeps the reason for the agent to read', async () => {
  const { createRequest, updateRequest, getRequest } = await queue();

  const request = await createRequest({ url: 'https://example.com', jobId: 'job-3' });
  await updateRequest(request.id, { status: 'declined', message: 'not a site I want copied' });

  assert.equal((await getRequest(request.id))?.message, 'not a site I want copied');
});

test('updating an unknown request is a miss, not a crash', async () => {
  const { updateRequest, getRequest } = await queue();

  assert.equal(await updateRequest('no-such-request', { status: 'done' }), undefined);
  assert.equal(await getRequest('no-such-request'), undefined);
});

test('the pending queue is capped so an agent cannot flood the popup', async () => {
  const { createRequest, listRequests } = await queue();

  // Two are already pending from the tests above at most; fill past the cap.
  const before = (await listRequests('pending')).length;
  for (let i = before; i < 25; i++) {
    await createRequest({ url: `https://example.com/${i}`, jobId: `fill-${i}` });
  }

  await assert.rejects(
    () => createRequest({ url: 'https://example.com/overflow', jobId: 'overflow' }),
    /already waiting/,
  );
});
