/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker / standalone deployment için: tüm bağımlılıkları tek klasörde toplar
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,

  // Next.js 14.2+ → top-level (experimental.serverComponentsExternalPackages deprecated)
  serverExternalPackages: [
    '@google/generative-ai',
    'exceljs',
    'googleapis',
    'fs-extra',
    'cheerio',
    'node-cron',
    'node-fetch',
    'sharp',
  ],
};

export default nextConfig;
