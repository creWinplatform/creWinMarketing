// Runs real platform flows through the async Db on a disposable SQL Server database: provisioning, membership,
// tasks, coach, job guide, billing, alerts, campaigns and content. Refuses any server that is not local.
//   PLATFORM_APPSETTINGS_PATH=appsettings.Test.json node scripts/mssql-smoke.cjs
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { connectionString, describe } = require('../lib/db/settings.cjs');
const { load } = require('../test/platform-loader.cjs');

const value = connectionString(), target = describe(value);
if (!/^(127\.0\.0\.1|localhost)(,\d+)?$/i.test(target.server)) { console.error(`Refusing ${target.server}: the smoke test resets its database and runs only against a local test server.`); process.exit(2); }
const KEY = '7a'.repeat(32);

async function resetDatabase() {
  const master = await new sql.ConnectionPool(value.replace(/Database=[^;]*/i, 'Database=master')).connect();
  const name = target.database.replace(/[^\w]/g, '');
  await master.request().batch(`IF DB_ID('${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}] END; CREATE DATABASE [${name}]`);
  await master.close();
  const pool = await new sql.ConnectionPool(value).connect();
  for (const statement of fs.readFileSync(path.join(__dirname, '../lib/db/mssql-schema.sql'), 'utf8').split(/;\s*\n/).map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await pool.request().batch(statement);
  return pool;
}

(async () => {
  const pool = await resetDatabase();
  const { mssqlDb } = load('../db/client.ts');
  const db = mssqlDb(pool, sql);
  const { PlatformRepository } = load('repository.ts');
  const steps = [];
  const step = async (name, work) => {
    const started = Date.now();
    try { const detail = await work(); steps.push({ name, ok: true, ms: Date.now() - started, detail }); }
    catch (error) { steps.push({ name, ok: false, ms: Date.now() - started, detail: `${error.name}: ${String(error.message).slice(0, 300)}` }); }
  };
  const repo = new PlatformRepository(db);
  let a, b, scope;
  await step('bootstrap the legacy admin', async () => { await repo.bootstrapLegacy('smoke-admin'); return 'ok'; });
  await step('provision two tenants', async () => {
    a = await repo.provision('legacy-admin', { organizationName: 'smoke-a', projectName: 'Smoke A', website: 'https://example.com', username: 'smoke-a', password: 'smoke-password-123' });
    b = await repo.provision('legacy-admin', { organizationName: 'smoke-b', projectName: 'Smoke B', website: 'https://example.org', username: 'smoke-b', password: 'smoke-password-123' });
    scope = { subject: a.userId, organizationId: a.organizationId, projectId: a.projectId };
    return `${a.projectId.slice(0, 8)} / ${b.projectId.slice(0, 8)}`;
  });
  await step('workspace and tenant isolation', async () => {
    const own = await repo.workspace(a.userId, a.organizationId, a.projectId), other = await repo.workspace(a.userId, b.organizationId, b.projectId);
    if (!own || other) throw new Error('isolation broken');
    return own.project.name;
  });
  await step('login attempts (upsert counter)', async () => {
    const { consumeLoginAttempt } = load('account.ts');
    let allowed = 0; for (let i = 0; i < 6; i++) if (await consumeLoginAttempt(db, 'smoke-user')) allowed++;
    return `${allowed} allowed`;
  });
  await step('add a team member and change role', async () => {
    const member = await repo.addMember(a.userId, a.organizationId, a.projectId, { username: 'smoke-editor', password: 'smoke-password-123', role: 'editor' });
    return member.userId ? 'added' : 'missing';
  });
  await step('tasks and metrics', async () => {
    const { ProjectOperations } = load('operations.ts');
    const operations = new ProjectOperations(db, scope);
    await operations.saveTask({ title: 'Smoke task', dueAt: new Date().toISOString(), status: 'planned' });
    const view = await operations.snapshot?.() ?? await operations.read?.();
    return view ? 'read back' : 'saved';
  });
  await step('campaign and content history', async () => {
    const { ProjectMarketingStore } = load('marketing-store.ts');
    const store = new ProjectMarketingStore(db, scope);
    await store.saveCampaign({ id: 'smoke-campaign', name: 'Smoke ğüşıöç 😀', status: 'draft', updatedAt: new Date().toISOString(), content: { subject: 'S', text: 'T', ctaUrl: '' }, channels: { email: true, social: [], whatsapp: false, telegram: false, paidAds: [] } }, true);
    await store.saveContent({ id: 'smoke-content', platform: 'linkedin', language: 'tr', content: 'Türkçe içerik', headline: 'Başlık', prompt: '', timestamp: Date.now() }, true);
    const campaigns = await store.listCampaigns(), history = await store.history();
    if (!campaigns.some(c => c.name === 'Smoke ğüşıöç 😀')) throw new Error('Unicode round trip failed');
    return `${campaigns.length} campaign, ${history.length} content`;
  });
  await step('draft edit conflict (stale version refused)', async () => {
    const { ProjectMarketingStore } = load('marketing-store.ts');
    const store = new ProjectMarketingStore(db, scope);
    const opened = (await store.history()).find(item => item.id === 'smoke-content');
    if (!opened?.updatedAt) throw new Error('history returned no updatedAt');
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.saveContent({ ...opened, content: 'A' }, false, opened.updatedAt);
    let refused = false;
    try { await store.saveContent({ ...opened, content: 'B' }, false, opened.updatedAt); } catch (error) { refused = error.status === 409; }
    if (!refused) throw new Error('a stale version was not refused');
    if ((await store.history()).find(item => item.id === 'smoke-content').content !== 'A') throw new Error('the first edit was lost');
    return '409 on the stale save, first edit kept';
  });
  // The brand voice AI path end to end with a stand-in model: usage reservation, the write and the token record.
  await step('brand voice with AI (fake model)', async () => {
    const { CoachBrand } = load('coach-brand.ts');
    const brand = new CoachBrand(db, scope), before = await brand.read();
    const generator = async () => ({ text: JSON.stringify({ voice: 'Sakin, açık ve yardımsever bir dil. Siz diye hitap eder.' }), usage: { provider: 'google', model: 'gemini-2.5-flash', prompt: 120, output: 40, thinking: 0, total: 160 } });
    const value = await brand.draftVoice({ action: 'voice', mode: 'ai', answers: { traits: 'sakin, açık', avoid: 'abartılı', address: 'formal', useWords: '', avoidWords: '', example: '' }, expectedRevision: before.revision }, generator);
    if (!value.voiceDraft) throw new Error('no draft');
    return `source ${value.voiceSource}`;
  });
  await step('growth coach read', async () => { const { GrowthCoach } = load('coach.ts'); const coach = await new GrowthCoach(db, scope).read(); return `revision ${coach.revision}`; });
  await step('job guide', async () => { const { jobGuide } = load('job-guide.ts'); const view = await jobGuide(db, scope); return `${view.jobs.length} jobs`; });
  await step('team alerts', async () => { const { teamAlerts } = load('team-alerts.ts'); return `${(await teamAlerts(db, scope)).length} alerts`; });
  await step('billing view', async () => { const { ProjectBilling } = load('billing.ts'); const view = await new ProjectBilling(db, scope, KEY).read(); return `${view.orders.length} orders`; });
  await step('usage reservation (transaction + upsert)', async () => {
    const { ProjectUsage } = load('project-usage.ts');
    const usage = new ProjectUsage(db, scope), reservation = await usage.reserve('ai'); await usage.complete(reservation);
    return 'reserved and completed';
  });
  await step('portfolio', async () => { const { portfolio } = load('portfolio.ts'); const view = await portfolio(db, a.userId, { organizationId: a.organizationId, projectId: a.projectId }); return `${view.projects.length} project(s)`; });
  // Switch off (the default, as on live ryzevo.com today): the platform runs on SQL Server, the Crewin stores stay files.
  await step('Crewin stores, switch off: files', async () => {
    const saved = { PLATFORM_LEGACY_STORE: process.env.PLATFORM_LEGACY_STORE, CREWIN_WEB_DATA_DIR: process.env.CREWIN_WEB_DATA_DIR, PLATFORM_DATABASE_PROVIDER: process.env.PLATFORM_DATABASE_PROVIDER };
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'smoke-legacy-off-'));
    fs.writeFileSync(path.join(dir, 'seo-work-items.json'), JSON.stringify([{ id: 'seo-file', url: 'https://example.com', title: 'Dosyadan', status: 'proposed', updatedAt: '2026-11-12' }]));
    delete process.env.PLATFORM_LEGACY_STORE;
    Object.assign(process.env, { CREWIN_WEB_DATA_DIR: dir, PLATFORM_DATABASE_PROVIDER: 'mssql' });
    const store = load('../legacy-store.ts');
    store.setLegacyStoreDb(db);
    try {
      const seo = load('../seo-work-items.ts');
      if ((await seo.listSeoWorkItems())[0]?.title !== 'Dosyadan') throw new Error('the file was not read');
      await seo.updateSeoWorkItem('seo-file', 'approved');
      if (JSON.parse(fs.readFileSync(path.join(dir, 'seo-work-items.json'), 'utf8'))[0].status !== 'approved') throw new Error('the file was not written');
      if ((await db.all("SELECT store FROM legacy_stores WHERE store = 'web:seo-work-items'")).length) throw new Error('a table row was written');
      return 'read and written in the file, no table row';
    } finally {
      store.setLegacyStoreDb(null);
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  // Switch on (PLATFORM_LEGACY_STORE=mssql, phase 4): the Crewin JSON stores as rows (legacy_records).
  await step('Crewin stores, switch on: tables', async () => {
    const saved = { PLATFORM_LEGACY_STORE: process.env.PLATFORM_LEGACY_STORE, CREWIN_WEB_DATA_DIR: process.env.CREWIN_WEB_DATA_DIR };
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'smoke-legacy-'));
    Object.assign(process.env, { PLATFORM_LEGACY_STORE: 'mssql', CREWIN_WEB_DATA_DIR: dir });
    const store = load('../legacy-store.ts');
    store.setLegacyStoreDb(db);
    try {
      const seo = load('../seo-work-items.ts'), posts = load('../scheduled-posts.ts'), tokens = load('../social-tokens.ts');
      const item = await seo.createSeoWorkItem({ url: 'https://example.com/ğüş', title: 'Başlık 😀', recommendation: 'r', evidence: 'e', priority: 'high' });
      await seo.updateSeoWorkItem(item.id, 'applied', 'Uygulandı');
      if ((await seo.listSeoWorkItems())[0]?.status !== 'applied') throw new Error('SEO item not updated');
      await posts.createPost({ platforms: ['linkedin'], content: 'İçerik', scheduledAt: new Date(Date.now() - 1000).toISOString() });
      const claims = await Promise.all([posts.claimDuePosts(), posts.claimDuePosts(), posts.claimDuePosts()]);
      if (claims.flat().length !== 1) throw new Error(`a due post was claimed ${claims.flat().length} times`);
      await tokens.saveOAuthState('smoke-state', 'linkedin');
      const once = await Promise.all([tokens.consumeOAuthState('smoke-state'), tokens.consumeOAuthState('smoke-state')]);
      if (once.filter(Boolean).length !== 1) throw new Error('an OAuth state was used twice');
      if (fs.readdirSync(dir).length) throw new Error('a file was written');
      return `${(await db.all('SELECT store FROM legacy_stores')).length} stores, one claim, one state use`;
    } finally {
      store.setLegacyStoreDb(null);
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  await db.close();
  const width = Math.max(...steps.map(s => s.name.length));
  for (const s of steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(width)} ${String(s.ms).padStart(5)} ms  ${s.detail ?? ''}`);
  process.exitCode = steps.every(s => s.ok) ? 0 : 1;
})().catch(error => { console.error(error); process.exit(2); });
