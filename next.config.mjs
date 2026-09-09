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
};

export default nextConfig;
