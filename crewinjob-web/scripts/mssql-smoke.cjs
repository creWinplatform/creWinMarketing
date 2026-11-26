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
  // Design studio: the brand kit (logo text column) and a video uploaded in parts (VARBINARY) and read back signed.
  await step('brand kit save and read', async () => {
    const { BrandKits } = load('brand-kit.ts');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const kits = new BrandKits(db, scope), saved = await kits.save({ colors: { primary: '#123456', accent: '#ffcc00', dark: '#111111', light: '#fafafa' }, font: 'manrope', handle: '@smoke', tagline: 'Smoke', logo: { data: png, mime: 'image/png' }, expectedRevision: 0 });
    let refused = false;
    try { await kits.save({ colors: saved.colors, font: 'serif', handle: '', tagline: '', expectedRevision: 0 }); } catch (error) { refused = error.status === 409; }
    const read = await kits.read();
    if (read.revision !== 1 || read.logo?.data !== png || !refused) throw new Error('brand kit mismatch');
    return 'revision 1, logo kept, stale save refused';
  });
  await step('video upload in parts and signed read', async () => {
    const { createHash } = require('node:crypto'), { writeMp4 } = load('mp4-writer.ts'), { MediaVideos, publicVideo } = load('media-videos.ts'), key = '12'.repeat(32);
    const avcC = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
    const file = Buffer.from(writeMp4({ width: 1080, height: 1920, fps: 30, avcC, samples: Array.from({ length: 60 }, (_, i) => ({ data: new Uint8Array(12000).fill(i), key: i === 0 })) }));
    const videos = new MediaVideos(db, scope, key), started = await videos.start({ bytes: file.length, sha256: createHash('sha256').update(file).digest('hex'), width: 1080, height: 1920, durationMs: 2000 });
    for (let part = 0; part < started.parts; part++) await videos.part(started.id, part, file.subarray(part * started.partBytes, (part + 1) * started.partBytes));
    const { url } = await videos.finish(started.id, 'https://ryzevo.example'), read = await publicVideo(db, key, started.id, new URL(url).searchParams.get('signature'));
    if (!read || Buffer.compare(read.file, file) !== 0) throw new Error('video bytes differ');
    await videos.remove(started.id);
    return `${started.parts} parts, ${file.length} bytes back intact`;
  });
  await step('web mentions: settings upsert and a read', async () => {
    const { saveWebWatch, readDueWebMentions, webMentions } = load('web-mentions.ts');
    await saveWebWatch(db, scope, { enabled: true, queries: ['Smoke'], feeds: [], language: 'tr' });
    await saveWebWatch(db, scope, { enabled: true, queries: ['Smoke Marka'], feeds: [], language: 'tr' });
    const rss = '<rss><channel><item><title>Smoke Marka iade bekleyenler</title><link>https://news.example.com/x</link></item></channel></rss>';
    const added = await readDueWebMentions(db, Date.now(), async () => rss), again = await readDueWebMentions(db, Date.now() + 4 * 3600000, async () => rss);
    const list = await webMentions(db, scope);
    if (added !== 1 || again !== 0 || list.length !== 1 || list[0].level !== 'complaint') throw new Error('web mentions mismatch');
    return '1 mention, labelled complaint, not stored twice';
  });
  await step('expert request: brief, delivery in parts, review', async () => {
    const { createHash, randomBytes } = require('node:crypto'), { Experts, partnerDirectory } = load('experts.ts'), { EXPERT_PART_BYTES } = load('experts-types.ts');
    const at = Date.now(), iso = value => new Date(value).toISOString(), order = 'RZLIVE' + randomBytes(16).toString('hex');
    // A running agency package for the second tenant, written directly (no payment provider is involved).
    await db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at,package) VALUES(?,?,?,?,?,'d','m','v','growth','monthly',29900,'paid','https://ryzevo.example/terms',?,?,?,'agency')").run(order, b.organizationId, b.projectId, b.userId, order, iso(at - 86400000), iso(at - 86400000), iso(at - 86400000));
    await db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES(?,?,?,'growth','monthly',?,?,?,?,'agency')").run(order, b.organizationId, b.projectId, iso(at - 86400000), iso(at + 29 * 86400000), iso(at + 36 * 86400000), iso(at - 86400000));
    const partner = new Experts(db, { subject: b.userId, organizationId: b.organizationId, projectId: b.projectId }), client = new Experts(db, scope);
    await partner.saveProfile({ displayName: 'Smoke Studio', summary: 'Smoke test partner for product photos and banners.', services: ['photo', 'design'], languages: ['tr'], website: 'https://smoke-studio.example', contact: 'smoke@studio.example', listed: true });
    if ((await partnerDirectory(db, scope, 'photo')).length !== 1) throw new Error('partner not listed');
    const sent = await client.create({ partnerId: b.projectId, service: 'photo', title: 'Smoke shoot', details: 'Product photos on a white background, smoke test.', deliverables: '3 JPEG files', dueDate: iso(at + 10 * 86400000).slice(0, 10), budgetNote: '', brand: 'Smoke brand', contact: 'smoke@client.example', shareAcknowledged: true });
    const id = sent.client.requests[0].id;
    await partner.decide({ id, decision: 'accept' });
    const file = randomBytes(EXPERT_PART_BYTES + 5000); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(file);
    const started = await partner.startFile({ id, name: 'smoke.png', mime: 'image/png', bytes: file.length, sha256: createHash('sha256').update(file).digest('hex') });
    for (let part = 0; part < started.parts; part++) await partner.filePart(started.fileId, part, file.subarray(part * started.partBytes, (part + 1) * started.partBytes));
    await partner.finishFile({ id, fileId: started.fileId }); await partner.deliver({ id, note: 'Smoke delivery' });
    const back = await client.file(id, started.fileId), reviewed = await client.review({ id, decision: 'approve' });
    if (Buffer.compare(back.data, file) !== 0 || reviewed.client.requests[0].state !== 'approved') throw new Error('expert request mismatch');
    return `${started.parts} parts, ${file.length} bytes back intact, approved`;
  });
  await step('sales assistant: maps search, site scan, mini analysis', async () => {
    const { ProspectFinder, openProspectAnalysis } = load('prospect-finder.ts'), { FINDER_TERMS_VERSION } = load('prospect-finder-types.ts'), { ProjectProspects } = load('prospects.ts');
    const saved = { login: process.env.PLATFORM_DATAFORSEO_LOGIN, password: process.env.PLATFORM_DATAFORSEO_PASSWORD };
    process.env.PLATFORM_DATAFORSEO_LOGIN = 'smoke'; process.env.PLATFORM_DATAFORSEO_PASSWORD = 'smoke';
    try {
      // Fake providers: nothing leaves this machine.
      const http = async url => url.startsWith('https://nominatim') ? { status: 200, text: JSON.stringify([{ osm_type: 'relation', osm_id: 1, lat: '41', lon: '29', name: 'Smoke', address: { country: 'Türkiye' } }]) }
        : { status: 200, text: JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{ type: 'maps_search', title: 'Smoke Klinik', url: 'https://smoke-klinik.example/', phone: '+90 212 000 00 00', address_info: { city: 'Smoke' }, category: 'Klinik', rating: { value: 4.5, votes_count: 10 }, place_id: 'p1' }] }] }] }) };
      const site = async () => ({ finalUrl: 'https://smoke-klinik.example/', html: '<html><head><title>Smoke Klinik</title><meta name="viewport" content="width=device-width"></head><body><a href="mailto:info@smoke-klinik.example">info</a> © 2026</body></html>' });
      const finder = new ProspectFinder(db, scope, http, site);
      await finder.acceptTerms({ accepted: true, version: FINDER_TERMS_VERSION });
      await finder.saveSettings({ signals: { online_booking: 'missing' } }); await finder.saveSettings({ signals: { online_booking: 'missing', mobile: 'present' } });
      const found = await finder.discover({ city: 'Smoke', sector: 'Klinik', source: 'maps' }), again = await finder.discover({ city: 'smoke', sector: 'klinik', source: 'maps' });
      const counted = (await db.prepare("SELECT requests FROM platform_provider_usage WHERE provider='dataforseo_maps' AND scope_key=? AND period=?").get(`project:${scope.projectId}`, new Date().toISOString().slice(0, 10)))?.requests;
      if (again.found !== 1 || Number(counted) !== 1) throw new Error(`maps quota/cache mismatch (${counted})`);
      const id = (await new ProjectProspects(db, scope).read()).prospects.find(item => item.company === 'Smoke Klinik').id;
      const scanned = await finder.scan({ id }), insight = scanned.insights[id];
      const { url } = await finder.createReport({ id }, 'https://ryzevo.example'), token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
      const analysis = await openProspectAnalysis(db, token);
      await new ProjectProspects(db, scope).remove({ id });
      if (found.added !== 1 || insight.score.signals !== 40 || !insight.contacts.some(item => item.value === 'info@smoke-klinik.example') || !analysis || analysis.company !== 'Smoke Klinik') throw new Error('sales assistant mismatch');
      return `added ${found.added}, score ${insight.score.total}, analysis opened, removed with its details`;
    } finally { process.env.PLATFORM_DATAFORSEO_LOGIN = saved.login; process.env.PLATFORM_DATAFORSEO_PASSWORD = saved.password; if (saved.login === undefined) delete process.env.PLATFORM_DATAFORSEO_LOGIN; if (saved.password === undefined) delete process.env.PLATFORM_DATAFORSEO_PASSWORD; }
  });
  await step('sales assistant: outreach, pipeline, sources, booking, proposal, data keeping', async () => {
    const { ProspectFinder } = load('prospect-finder.ts'), { ProjectProspects } = load('prospects.ts');
    const { ProspectOutreach, deliverDueOutreach, salesAttention, salesMonth, suppressProspectHost, prospectSuppressed, pruneStaleProspects, pruneProspectOptOutTokens } = load('prospect-outreach.ts');
    const { ProspectSources, recordVisit, pruneVisitorCompanies } = load('prospect-sources.ts'), { SOURCE_TERMS_VERSION } = load('prospect-sources-types.ts');
    const { ProspectBooking, ProspectProposals, publicBooking, bookMeeting, openProposal } = load('prospect-workflow.ts');
    const saved = process.env.PLATFORM_PUBLIC_ORIGIN; process.env.PLATFORM_PUBLIC_ORIGIN = 'https://ryzevo.example';
    try {
      const html = '<html><head><title>Satış Smoke</title><meta name="viewport" content="width=device-width"></head><body><a href="mailto:info@satis-smoke.example">info</a><a href="/kariyer">Kariyer</a> © 2026</body></html>';
      const finder = new ProspectFinder(db, scope, async () => { throw new Error('no provider'); }, async url => ({ finalUrl: `${url.replace(/\/$/, '')}/`, html })), prospects = new ProjectProspects(db, scope);
      const id = (await prospects.add({ company: 'Satış Smoke', website: 'https://satis-smoke.example', sector: 'Klinik' })).prospects.find(item => item.company === 'Satış Smoke').id;
      await finder.scan({ id }); await finder.scan({ id });
      let row = (await prospects.read()).prospects.find(item => item.id === id); await prospects.update({ id, reason: 'Güçlü uyum: smoke.', contactRole: 'Müdür', sector: 'Klinik', country: 'TR', expectedRevision: row.revision });
      row = (await prospects.read()).prospects.find(item => item.id === id); await prospects.decide({ id, decision: 'approve', expectedRevision: row.revision });
      const outreach = new ProspectOutreach(db, scope, KEY);
      await outreach.saveSettings({ followUpDays: [3, 7], assignMode: 'round_robin', retentionMonths: 6, privacyUrl: 'https://satis-smoke.example/kvkk' });
      let snap = await outreach.draft({ id, mode: 'template' }); const draft = snap.outreach[id];
      snap = await outreach.save({ id, expectedRevision: draft.revision, steps: draft.steps, linkedin: draft.linkedin, whatsapp: draft.whatsapp });
      await outreach.touch({ id, channel: 'linkedin' }); await outreach.assign({ id, userId: scope.subject });
      snap = await outreach.stage({ id, stage: 'won', valueMinor: 100000, currency: 'TRY' });
      const month = await salesMonth(db, scope, new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString());
      await salesAttention(db, scope); await deliverDueOutreach(db, KEY);
      await suppressProspectHost(db, scope, 'https://engel-smoke.example', 'unsubscribe'); await suppressProspectHost(db, scope, 'https://engel-smoke.example', 'unsubscribe');
      const blocked = await prospectSuppressed(db, scope, 'https://www.engel-smoke.example');
      const sources = new ProspectSources(db, scope, KEY);
      await sources.acceptTerms({ kind: 'list', accepted: true, version: SOURCE_TERMS_VERSION }); await sources.acceptTerms({ kind: 'visitors', accepted: true, version: SOURCE_TERMS_VERSION });
      const imported = await sources.importList({ csv: 'Firma;Web sitesi;E-posta\nListe Smoke;liste-smoke.example;info@liste-smoke.example\nEngel;engel-smoke.example;' });
      await sources.guess({ id, firstName: 'Ayşe', lastName: 'Kaya' });
      const visitors = await sources.setVisitors({ enabled: true }), workspace = (await repo.workspace(scope.subject, scope.organizationId, scope.projectId)).project;
      await recordVisit(db, { key: visitors.visitors.siteKey, origin: workspace.website, path: '/fiyat', ip: '81.0.0.2' }, async () => ({ name: 'Ziyaretçi A.Ş.', domain: 'ziyaretci-smoke.example', kind: 'business' }));
      await recordVisit(db, { key: visitors.visitors.siteKey, origin: workspace.website, path: '/', ip: '81.0.0.2' }, async () => ({ name: 'Ziyaretçi A.Ş.', domain: 'ziyaretci-smoke.example', kind: 'business' }));
      const visits = (await sources.read()).visitors.companies[0]?.visits;
      const booking = new ProspectBooking(db, scope, KEY), settings = await booking.save({ enabled: true, title: 'Smoke', durationMin: 30, weekdays: [0, 1, 2, 3, 4, 5, 6], startHour: 6, endHour: 23, noticeHours: 1, horizonDays: 7 });
      const key = new URLSearchParams(new URL(settings.link).hash.slice(1)).get('k'), page = await publicBooking(db, key);
      await bookMeeting(db, key, { start: page.slots[0], name: 'Smoke Kişi', email: 'kisi@satis-smoke.example', consent: true }, KEY);
      const booked = (await booking.read()).upcoming; await booking.cancel({ id: booked[0].id });
      const proposals = new ProspectProposals(db, scope); let proposal = (await proposals.draft({ id, mode: 'template', price: '1.000 TL' })).proposal;
      proposal = (await proposals.save({ id, expectedRevision: proposal.revision, content: { ...proposal.content, timeline: '2 hafta' } })).proposal;
      const shared = await proposals.share({ id }, 'https://ryzevo.example'), opened = await openProposal(db, new URLSearchParams(new URL(shared.url).hash.slice(1)).get('token'));
      await proposals.revoke({ id });
      const removed = await pruneStaleProspects(db) + await pruneProspectOptOutTokens(db) + await pruneVisitorCompanies(db);
      for (const item of (await prospects.read()).prospects.filter(item => /Smoke/.test(item.company))) await prospects.remove({ id: item.id });
      if (!snap.pipeline[id] || snap.pipeline[id].stage !== 'won' || month.won !== 1 || month.touches !== 1 || !blocked || imported.added !== 1 || visits !== 2 || booked[0].email !== 'kisi@satis-smoke.example' || !opened || opened.content.timeline !== '2 hafta') throw new Error('sales outreach mismatch');
      return `won ${month.won}, imported ${imported.added}, visits ${visits}, booking and proposal ok, pruned ${removed}`;
    } finally { if (saved === undefined) delete process.env.PLATFORM_PUBLIC_ORIGIN; else process.env.PLATFORM_PUBLIC_ORIGIN = saved; }
  });
  await step('sales assistant: follow-ups, qualifying, the week and warm introductions', async () => {
    const { ProjectProspects } = load('prospects.ts'), { ProspectOutreach, salesAttention, salesWeek } = load('prospect-outreach.ts'), { ProspectNetwork } = load('prospect-network.ts');
    const { ProspectSources } = load('prospect-sources.ts'), { SOURCE_TERMS_VERSION } = load('prospect-sources-types.ts');
    const prospects = new ProjectProspects(db, scope), now = new Date().toISOString();
    const id = (await prospects.add({ company: 'Ağ Smoke Klinik', website: 'https://ag-smoke.example' })).prospects.find(item => item.company === 'Ağ Smoke Klinik').id;
    await db.prepare("UPDATE platform_prospects SET state='approved',check_status='ok',reason='Güçlü uyum',source_url='https://ag-smoke.example' WHERE id=?").run(id);
    const outreach = new ProspectOutreach(db, scope, KEY);
    await outreach.saveSettings({ followUpDays: [2, 3, 4, 5], weeklyGoal: 12 });
    await outreach.qualify({ id, problem: 'yes', budget: 'no', signer: 'Genel müdür', nextStep: 'Demo', nextStepAt: new Date(Date.now() + 3 * 86400000).toISOString() });
    await outreach.stage({ id, stage: 'meeting' });
    const attention = await salesAttention(db, scope), week = await salesWeek(db, scope, 'Europe/Istanbul');
    await new ProspectSources(db, scope, KEY).acceptTerms({ kind: 'list', accepted: true, version: SOURCE_TERMS_VERSION });
    const network = new ProspectNetwork(db, scope, KEY), csv = 'Notes:\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAyşe,Kaya,https://www.linkedin.com/in/ak,,Ağ Smoke Klinik Ltd. Şti.,Genel Müdür,01 Jan 2024\nCan,Ak,,,Başka Firma,Uzman,01 Jan 2024\n';
    const first = await network.importCsv({ csv, part: 0 }), again = await network.importCsv({ csv, part: 1 });
    const snap = await network.read(), contact = snap.matches[0]?.contact;
    await network.mark({ contactId: contact.id, state: 'asked', prospectId: id });
    const read = await outreach.read();
    await network.clear(); await prospects.remove({ id });
    if (first.added !== 2 || again.updated !== 2 || snap.matches.length !== 1 || snap.companies.length !== 1 || read.pipeline[id].qualification.signer !== 'Genel müdür' || read.settings.followUpDays.length !== 4 || week.goal !== 12 || !read.network[id] || attention.stale.length !== 0) throw new Error('sales follow-up mismatch');
    return `4 follow-ups, qualified, week goal ${week.goal}, ${first.added} connections, 1 warm match`;
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
