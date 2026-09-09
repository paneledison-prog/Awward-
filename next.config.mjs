/**
 * Plain .mjs rather than .ts on purpose: the production image installs only
 * production dependencies, and a TypeScript config would put loading it at the
 * mercy of whether the runtime can still parse TS. JSDoc gives the same
 * editor type-checking with none of that risk.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Playwright must stay external — bundling it breaks the browser launcher.
  serverExternalPackages: ['playwright', 'playwright-core'],

  /**
   * Origins allowed to reach dev-only endpoints.
   *
   * `next dev` blocks cross-origin requests to dev assets, and "cross-origin"
   * means anything other than the hostname the server booted with — `localhost`
   * by default. Opening the dev server on `127.0.0.1` or over the LAN (which is
   * the whole point of `dev:lan`, e.g. testing on a phone) therefore gets its
   * HMR WebSocket refused. Turbopack's module runtime rides on that socket, so
   * the page renders and then never hydrates: every control is dead, with only
   * a WebSocket error in the console to explain it.
   *
   * Private ranges only — this never widens anything in production, where the
   * option has no effect at all.
   */
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '[::1]',
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '172.17.*.*',
    '172.18.*.*',
    '172.19.*.*',
    '*.local',
  ],
};

export default nextConfig;
