import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aktif dev sunucusunun .next klasörünü bozmadan CI/build doğrulaması yapılabilir.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Docker / standalone deployment için: tüm bağımlılıkları tek klasörde toplar
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  // Agent modules are packaged separately; keep server.js at the runner root.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),

  // Next.js 14 → experimental altında (15'te top-level'a taşındı)
  serverExternalPackages: [
      'better-sqlite3',
      'nodemailer',
      '@google/generative-ai',
      'exceljs',
      'googleapis',
      'fs-extra',
      'cheerio',
      'node-cron',
      'node-fetch',
      'sharp',
  ],
  async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Content-Security-Policy',value:"frame-ancestors 'self'; object-src 'none'; base-uri 'self'"}]}];},
};

export default nextConfig;
