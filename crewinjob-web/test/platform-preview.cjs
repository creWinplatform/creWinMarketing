// Isolated UI fixture: no data or credentials from the live project are used.
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { load } = require('./platform-loader.cjs');
const path = require('node:path');
const directory = mkdtempSync(path.join(tmpdir(), 'marketing-platform-preview-'));
const port = 31450;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], {
  cwd: path.join(__dirname, '..'), windowsHide: true,
  env: { ...process.env, NEXT_DIST_DIR: '.next-monolith-platform', PLATFORM_DATABASE_PATH: path.join(directory, 'preview.sqlite'),
    AUTH_SECRET: 'test-only-platform-preview-session-secret', PLATFORM_ENCRYPTION_KEY: '12'.repeat(32), ADMIN_USERNAME: 'fixture-admin', ADMIN_PASSWORD: 'fixture-admin-password', PORT: String(port),
    PLATFORM_GOOGLE_CLIENT_ID: 'fixture-google-client', PLATFORM_GOOGLE_CLIENT_SECRET: 'fixture-google-secret', PLATFORM_GOOGLE_REDIRECT_URI: `${base}/api/platform/google/callback`,
    PLATFORM_LINKEDIN_CLIENT_ID: 'fixture-linkedin-client', PLATFORM_LINKEDIN_CLIENT_SECRET: 'fixture-linkedin-secret', PLATFORM_LINKEDIN_REDIRECT_URI: `${base}/api/platform/social/callback`,
    PLATFORM_META_APP_ID: 'fixture-meta-app', PLATFORM_META_APP_SECRET: 'fixture-meta-secret', PLATFORM_META_REDIRECT_URI: `${base}/api/platform/meta/callback`, PLATFORM_META_GRAPH_VERSION: 'v25.0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', data => process.stdout.write(data));
server.stderr.on('data', data => process.stderr.write(data));
server.on('exit', code => process.exit(code || 0));
process.on('SIGINT', () => server.kill());
process.on('SIGTERM', () => server.kill());
const request = (url, cookie, body) => fetch(`${base}${url}`, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json', Origin: base }, ...(body ? { body: JSON.stringify(body) } : {}) });
(async () => {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/login')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Preview server did not start.');
  const adminLogin = await request('/api/auth/login', '', { username: 'fixture-admin', password: 'fixture-admin-password' });
  const admin = adminLogin.headers.get('set-cookie').split(';')[0];
  const created = await request('/api/platform/organizations', admin, { organizationName: 'Northstar Studio', projectName: 'Northstar', website: 'https://product.example', username: 'ui-test-owner', password: 'ui-test-password-123' });
  if (!created.ok) throw new Error('Could not create UI fixture.');
  const tenant = await created.json();
  const ownerLogin = await request('/api/auth/login', '', { username: 'ui-test-owner', password: 'ui-test-password-123' });
  const owner = ownerLogin.headers.get('set-cookie').split(';')[0];
  await request('/api/campaigns', owner, { name: 'İlk değer: yeni kullanıcı aktivasyonu', objective: 'registration', status: 'draft', channels: { email: true }, content: { text: 'Ürününüzle ilk adımı atın. Ekibinizin çalışma alanını kurun, ilk hedefinizi belirleyin ve sıradaki işi birlikte planlayın.', subject: 'Bir sonraki adımınız için hazırız' } });
  await request('/api/campaigns', owner, { name: 'Yeni ekipler için ürün demosu', objective: 'awareness', status: 'draft', channels: { email: false, social:['linkedin'] }, content: { text: 'İyi fikirleri işe dönüştürün. Ürününüzü ve ekibinizin önceliklerini tek bir çalışma alanında buluşturun.' } });
  await request('/api/campaigns', owner, { name: 'Ekim: marka hikâyesi', objective: 'awareness', status: 'draft', channels: { email: false, social:['instagram','linkedin'] }, content: { text: 'Her girişimin büyüme yolu farklıdır. Bizim hikâyemiz, ekiplerin doğru işe odaklanmasını kolaylaştırmakla başladı.' } });
  await request('/api/data/content-history', owner, { content: 'Büyüme bir sonraki doğru işle başlar. Ekibinizin hedeflerini günlük çalışma düzeniyle buluşturun.', platform: 'linkedin', language: 'tr', headline: 'Bir sonraki doğru iş' });
  await request('/api/marketing/connections', owner, { provider: 'email', integrationId: 'fixture-smtp', accountName: 'UI fixture SMTP', accessToken: 'fixture-only-unused-secret', smtp: { host: 'smtp.sendgrid.net', port: 587, user: 'fixture-user', fromEmail: 'sender@example.com', fromName: 'Test Product' } });
  await request('/api/marketing/connections', owner, { provider: 'social', accountName: 'UI fixture LinkedIn', accessToken: 'fixture-only-unused-social-secret', social: { platform: 'linkedin', accountId: 'FixtureSubject' } });
  const db = load('database.ts').openPlatformDatabase(path.join(directory, 'preview.sqlite'));
  let choice;
  try {
    const repository=new (load('repository.ts').PlatformRepository)(db);
    repository.updateProject(tenant.userId,tenant.organizationId,tenant.projectId,{name:'Northstar',website:'https://product.example',timezone:'Europe/Istanbul',language:'tr',brandVoice:'Açık, kısa ve ürün odaklı.',goals:[{id:'activation',label:{tr:'Ürün aktivasyonu',en:'Product activation'},audience:{tr:'Yeni kullanıcılar',en:'New users'},stages:[{tr:'Kayıt',en:'Signup'},{tr:'İlk kullanım',en:'First use'},{tr:'Aktivasyon',en:'Activation'}]},{id:'b2b',label:{tr:'Şirket kazanımı',en:'Company acquisition'},audience:{tr:'B2B müşteriler',en:'B2B customers'},stages:[{tr:'Talep',en:'Lead'},{tr:'Demo',en:'Demo'},{tr:'Müşteri',en:'Customer'}]}]});
    const operations=new (load('operations.ts').ProjectOperations)(db,{subject:tenant.userId,organizationId:tenant.organizationId,projectId:tenant.projectId});
    operations.saveTask({title:'İlk kampanya içeriğini gözden geçir',dueAt:new Date(Date.now()+86400000).toISOString(),status:'planned',note:'Örnek proje iş planı.'});
    operations.saveTask({title:'Ürün demosu davetini hazırla',dueAt:new Date(Date.now()+172800000).toISOString(),status:'in_progress',note:'Örnek proje iş planı.'});
    // Clearly labelled demonstration observations; never written to the application's data file.
    [42,18,7].forEach((value,stageIndex) => operations.saveMetric({goalId:'activation',stageIndex,value,observedAt:new Date().toISOString(),note:'Örnek proje ölçümü; gerçek müşteri verisi değildir.'}));
    choice = new (load('oauth-requests.ts').OAuthRequests)(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId }, '12'.repeat(32)).create('meta_selection', 'instagram', 'Fixture Meta', {
      accessToken: 'fixture-only-unused-meta-token', expiresAt: Date.now() + 3600000, graphVersion: 'v25.0', loaded: true,
      pages: [{ id: '100', name: 'Fixture Page Without Instagram', token: 'fixture-only-unused-page-token' }, { id: '200', name: 'Fixture Maritime Business Page', token: 'fixture-only-unused-page-token', instagramId: '300', instagramUsername: 'fixture_maritime' }],
    });
  } finally { db.close(); }
  // One-shot local fixture portal sets test cookies; no test endpoint is added to Next.
  const portal = createServer((req, res) => {
    if (req.url !== '/meta-qa') { res.writeHead(404); res.end(); return; }
    res.writeHead(302, { Location: base, 'Set-Cookie': [`${owner}; HttpOnly; SameSite=Lax; Path=/`, `platform_meta_selection=${choice.state}.${choice.browser}; HttpOnly; SameSite=Lax; Path=/api/platform/meta; Max-Age=600`] });
    res.end(); portal.close();
  });
  await new Promise((resolve, reject) => { portal.once('error', reject); portal.listen(31451, '127.0.0.1', resolve); });
  console.log('Meta fixture portal ready at http://127.0.0.1:31451/meta-qa');
  console.log(`UI fixture ready at ${base}`);
})().catch(error => { console.error(error.message); server.kill(); });
