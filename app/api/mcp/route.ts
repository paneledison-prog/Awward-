import { NextResponse } from 'next/server';
import { RPC, failure } from '@/lib/mcp/rpc';
import { handleMcpBody } from '@/lib/mcp/server';
import type { ToolContext } from '@/lib/mcp/tools';

export const runtime = 'nodejs';
// A tool call holds the connection open while a page renders at three
// viewports; the default budget cuts that off mid-extraction.
export const maxDuration = 300;

/** The instance's own origin, so tool output can link back to it. */
function originOf(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) return `${forwardedProto ?? 'https'}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failure(null, RPC.PARSE_ERROR, 'Invalid JSON.'), { status: 400 });
  }

  const ctx: ToolContext = { origin: originOf(request) };
  const { status, body: payload } = await handleMcpBody(body, ctx);

  if (!payload) return new Response(null, { status });
  return NextResponse.json(payload, { status });
}

/** No SSE stream: this server is stateless and never initiates a message. */
export function GET() {
  return new Response('This MCP endpoint accepts POST only.', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
