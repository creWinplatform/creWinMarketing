'use strict';
/**
 * crewinjob Marketing Pipeline
 *
 * Kullanım:
 *   node pipeline.js                → daemon (her 4 saatte bir tam döngü)
 *   node pipeline.js --once         → tek sefer çalıştır, çık
 *   node pipeline.js --dry-run      → gerçek ilan oluşturmadan test et
 *   node pipeline.js --discover     → sadece grup keşfi ve katılım
 *   node pipeline.js --scrape       → sadece mesaj çek & ilan oluştur
 *   node pipeline.js --broadcast    → sadece yeni ilanları gruplara paylaş
 */
'use strict';
// Config: tüm modüllerle aynı öncelik — process.env kazanır, sonra .userbot-config.json,
// sonra .env yalnızca tanımsız anahtarları doldurur (bkz. modules/agent-config.js).
require('./modules/agent-config').loadAgentConfig();

const args     = process.argv.slice(2);
const once     = args.includes('--once');
const dryRun   = args.includes('--dry-run');
const discover = args.includes('--discover');
const scrapeOnly = args.includes('--scrape');
const broadcastOnly = args.includes('--broadcast');

async function main() {
  if (discover) {
    const { discoverGroups, joinDiscoveredGroups } = require('./modules/group-discovery');
    console.log('🔍 Grup keşfi başlıyor...');
    const found = await discoverGroups();
    console.log(`✅ ${found.length} yeni grup keşfedildi.`);
    const joined = await joinDiscoveredGroups();
    console.log(`✅ ${joined} gruba katılındı.`);
    process.exit(0);
  }

  if (scrapeOnly) {
    const { runPipeline } = require('./modules/auto-poster');
    console.log('📋 Pipeline tek sefer çalışıyor...');
    const result = await runPipeline({ maxJobs: 20, dryRun });
    console.log('Sonuç:', result);
    process.exit(0);
  }

  if (broadcastOnly) {
    const { broadcastNewJobs } = require('./modules/group-broadcaster');
    console.log('📢 Broadcast başlıyor...');
    const sent = await broadcastNewJobs(10);
    console.log(`✅ ${sent} mesaj gönderildi.`);
    process.exit(0);
  }

  if (once) {
    const { fullCycle } = require('./modules/pipeline-scheduler');
    console.log('🔄 Tek sefer tam döngü...');
    await fullCycle({ maxJobs: 20, maxBroadcast: 5 });
    const { disconnect } = require('./modules/tg-client');
    await disconnect();
    process.exit(0);
  }

  // Default: daemon modu
  const { startScheduler } = require('./modules/pipeline-scheduler');
  await startScheduler({ maxJobs: 15, maxBroadcast: 5 });
}

main().catch(e => {
  console.error('[pipeline] Fatal:', e.message);
  process.exit(1);
});
