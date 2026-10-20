import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Lint is executed explicitly via `npm run lint` so builds stay fast and
    // CI failures are attributed to the right step.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // three.js ships large ESM graphs; keep the client bundle tree-shakeable.
    optimizePackageImports: ['three'],
  },
};

export default nextConfig;
