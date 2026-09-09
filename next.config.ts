import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Playwright must stay external — bundling it breaks the browser launcher.
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default nextConfig;
