import { fileURLToPath } from 'node:url';

const BASE_CSP = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";
// Voice features (off by default; docs/voice/ENABLE-CHECKLIST.md). Only with VOICE_FEATURES_ENABLED and
// NEXT_PUBLIC_VOICE_FEATURES_ENABLED both on at build time, the booking page (where the voice assistant lives) may use
// the microphone and connect to ElevenLabs in the chosen region; nothing else changes. Off, no header is added or changed.
const on = value => value === '1' || value === 'true';
function voiceHeaders(env = process.env) {
  if (!on(env.VOICE_FEATURES_ENABLED) || !on(env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED)) return [];
  const host = (env.VOICE_PROVIDER_REGION || '').trim().toUpperCase() === 'EU' ? 'api.eu.residency.elevenlabs.io' : 'api.elevenlabs.io';
  return [{ source: '/randevu', headers: [
    { key: 'Permissions-Policy', value: 'microphone=(self)' },
    // Replaces the CSP of the rule above for this page (Next.js: the last matching rule wins for the same key).
    { key: 'Content-Security-Policy', value: `${BASE_CSP}; connect-src 'self' https://${host} wss://${host}` },
  ] }];
}

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
  async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Content-Security-Policy',value:BASE_CSP}]},...voiceHeaders()];},
};

export default nextConfig;
