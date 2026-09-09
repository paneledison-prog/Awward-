/**
 * The origin the caller actually used.
 *
 * `new URL(request.url).origin` reports the address the server bound to, which
 * for a container is 0.0.0.0 — a URL nobody can open. The Host header is what
 * the browser asked for, and behind Fly's proxy `x-forwarded-proto` is what
 * says the public scheme is https rather than the http spoken internally.
 */
export function requestOrigin(request: Request): string {
  const host = request.headers.get('host');
  if (!host) return new URL(request.url).origin;

  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host);
  const proto = forwarded ?? (isLocal ? 'http' : 'https');

  return `${proto}://${host}`;
}
