import {
  PROTOCOL_VERSIONS,
  RPC,
  failure,
  isNotification,
  isRequest,
  result,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './rpc';
import { TOOLS, TOOL_MAP, type ToolContext } from './tools';

/**
 * The MCP server itself, independent of how it is served.
 *
 * The route handler is an adapter over this: keeping the protocol here means
 * it can be exercised message by message in a test without a running server.
 */
export const SERVER_INFO = { name: 'designdna', version: '1.0.0', title: 'DesignDNA' };

const INSTRUCTIONS =
  'Extract a site design system and its components. Start with extract_page (a whole page) ' +
  'or extract_component (one element by CSS selector), then read the result with get_brief, ' +
  'list_components and get_component. Screenshots are the visual check on a build.';

export async function dispatch(rpc: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
  switch (rpc.method) {
    case 'initialize': {
      const asked = (rpc.params?.protocolVersion as string) ?? '';
      return result(rpc.id, {
        // Speak the client's version when it is one we know; otherwise answer
        // with ours and let it decide.
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return result(rpc.id, {});

    case 'tools/list':
      return result(rpc.id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case 'tools/call': {
      const name = rpc.params?.name;
      const tool = typeof name === 'string' ? TOOL_MAP.get(name) : undefined;
      if (!tool) {
        return failure(rpc.id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      }

      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return result(rpc.id, await tool.handler(args, ctx));
      } catch (error) {
        // A tool that fails is a result the model can act on, not a protocol
        // error: it should read the message and try something else.
        return result(rpc.id, {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }

    default:
      // Notifications (no id) are acknowledged with silence, including the
      // `notifications/initialized` every client sends after the handshake.
      if (isNotification(rpc)) return null;
      return failure(rpc.id, RPC.METHOD_NOT_FOUND, `Unknown method: ${rpc.method}`);
  }
}


/**
 * Handle one HTTP body's worth of JSON-RPC: a single message or a batch.
 *
 * A body of nothing but notifications gets 202 and an empty response — the
 * spec's way of saying "received, nothing to say back".
 */
export async function handleMcpBody(
  body: unknown,
  ctx: ToolContext,
): Promise<{ status: number; body: JsonRpcResponse | JsonRpcResponse[] | null }> {
  const batch = Array.isArray(body) ? body : [body];
  const responses: JsonRpcResponse[] = [];

  for (const entry of batch) {
    if (!isRequest(entry)) {
      responses.push(failure(null, RPC.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.'));
      continue;
    }
    const response = await dispatch(entry, ctx);
    if (response) responses.push(response);
  }

  if (responses.length === 0) return { status: 202, body: null };
  return { status: 200, body: Array.isArray(body) ? responses : responses[0] };
}
