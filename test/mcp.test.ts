import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOLS, TOOL_MAP } from '../lib/mcp/tools';
import { PROTOCOL_VERSIONS, isNotification, isRequest } from '../lib/mcp/rpc';
import { handleMcpBody } from '../lib/mcp/server';

/** One HTTP body's worth of protocol, without a server in front of it. */
async function rpc(body: unknown): Promise<{ status: number; json: unknown }> {
  const { status, body: payload } = await handleMcpBody(body, { origin: 'https://designdna.test' });
  return { status, json: payload };
}

test('initialize answers with the version the client asked for', async () => {
  const { json } = (await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  })) as { json: { result: { protocolVersion: string; serverInfo: { name: string } } } };

  assert.equal(json.result.protocolVersion, '2025-03-26');
  assert.equal(json.result.serverInfo.name, 'designdna');
});

test('an unknown protocol version falls back to ours', async () => {
  const { json } = (await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  })) as { json: { result: { protocolVersion: string } } };

  assert.equal(json.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('tools/list returns every tool with a schema', async () => {
  const { json } = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as {
    json: { result: { tools: { name: string; description: string; inputSchema: { type: string } }[] } };
  };

  const tools = json.result.tools;
  assert.equal(tools.length, TOOLS.length);
  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a description an agent can act on`);
    assert.equal(tool.inputSchema.type, 'object');
  }
  assert.ok(tools.some((t) => t.name === 'extract_component'));
});

test('a notification is acknowledged with no body', async () => {
  const { status, json } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(status, 202);
  assert.equal(json, null);
});

test('an unknown method is a JSON-RPC error, an unknown tool an invalid param', async () => {
  const unknownMethod = (await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' })) as {
    json: { error: { code: number } };
  };
  assert.equal(unknownMethod.json.error.code, -32601);

  const unknownTool = (await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'nope', arguments: {} },
  })) as { json: { error: { code: number } } };
  assert.equal(unknownTool.json.error.code, -32602);
});

test('a failing tool reports isError rather than breaking the protocol', async () => {
  const { json } = (await rpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'get_brief', arguments: { extraction_id: 'does-not-exist' } },
  })) as { json: { result: { isError: boolean; content: { text: string }[] } } };

  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /No extraction/);
});

test('malformed requests are rejected without taking the batch down', async () => {
  const { json } = (await rpc([
    { not: 'a request' },
    { jsonrpc: '2.0', id: 9, method: 'ping' },
  ])) as { json: { id: number | null; error?: { code: number }; result?: unknown }[] };

  assert.equal(json.length, 2);
  assert.equal(json[0].error?.code, -32600);
  assert.deepEqual(json[1].result, {});
});

test('every tool name is unique and addressable', () => {
  assert.equal(TOOL_MAP.size, TOOLS.length);
  for (const tool of TOOLS) assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
});

test('request shape checks accept notifications and reject junk', () => {
  assert.ok(isRequest({ jsonrpc: '2.0', method: 'ping' }));
  assert.ok(!isRequest({ jsonrpc: '1.0', method: 'ping' }));
  assert.ok(!isRequest(null));
  assert.ok(isNotification({ jsonrpc: '2.0', method: 'ping' }));
  assert.ok(!isNotification({ jsonrpc: '2.0', id: 1, method: 'ping' }));
});
