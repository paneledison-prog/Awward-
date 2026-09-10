/**
 * MCP over HTTP, as a JSON-RPC envelope.
 *
 * The official SDK's streamable transport wants Node's `req`/`res` objects,
 * which an App Router handler does not have. What it would provide on top of
 * this file is session management and server-initiated messages — neither of
 * which a stateless, tools-only server uses. The surface below is the whole of
 * what such a server has to answer.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Spec-defined codes. -32000 and below are ours to use. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function result(id: JsonRpcRequest['id'], value: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result: value };
}

export function failure(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

export function isRequest(value: unknown): value is JsonRpcRequest {
  const candidate = value as JsonRpcRequest | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.jsonrpc === '2.0' &&
    typeof candidate.method === 'string'
  );
}

/** A notification carries no id and must never be answered. */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}
