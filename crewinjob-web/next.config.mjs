/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker / standalone deployment için: tüm bağımlılıkları tek klasörde toplar
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,

  // Next.js 14 → experimental altında (15'te top-level'a taşındı)
  experimental: {
    serverComponentsExternalPackages: [
      '@google/generative-ai',
      'exceljs',
      'googleapis',
      'fs-extra',
      'cheerio',
      'node-cron',
      'node-fetch',
      'sharp',
    ],
  },
};

export default nextConfig;
