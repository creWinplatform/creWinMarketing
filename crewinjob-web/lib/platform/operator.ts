import 'server-only';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import { googleAdsConfigured } from './ad-providers';
import { googleConfiguration } from './google-client';
import { identityEmailConfiguration } from './identity-email';
import { linkedinConfiguration } from './linkedin-client';
import { linkedinOrganizationConfiguration } from './linkedin-organization-publishing';
import { metaConfiguration } from './meta-client';
import { paytrConfiguration, paytrLiveReadiness } from './paytr';
import { publicEmailOrigin } from './email-safety';
import { metaInboxHookConfigured } from './social-inbox';
import { xConfiguration } from './x-client';
import { FUNNEL_STEPS, type ConnectionHealth, type FunnelSnapshot, type FunnelStep, type ProbeResult, type ReadinessGroup, type ReadinessItem, type ReadinessSnapshot, type ReadinessState } from './operator-types';

// Operator console for the team running Ryzevo (the deployment administrator, never a customer).
// Readiness: which server settings are present and which switches are on. Values are never returned.
// Funnel: how many standard projects reached each setup milestone. Counts only, no names or addresses.
const l = (tr: string, en: string): LocalizedText => ({ tr, en });
const works = (fn: () => unknown) => { try { return Boolean(fn()); } catch { return false; } };
const on = (name: string) => process.env[name] === '1';
const https = (value: string | undefined) => { try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const item = (id: string, group: ReadinessGroup, state: ReadinessState, label: LocalizedText, detail: LocalizedText, env: string[], probe?: 'gemini'): ReadinessItem => ({ id, group, state, label, detail, env, ...(probe ? { probe } : {}) });
const toggle = (id: string, group: ReadinessGroup, name: string, label: LocalizedText, onText: LocalizedText, offText: LocalizedText) =>
  item(id, group, on(name) ? 'ready' : 'off', label, on(name) ? onText : offText, [name]);

// Live payments need the switch, merchant details, USD approval, an https origin and a public terms page.
function paytrItem(): ReadinessItem {
  const env = ['PLATFORM_PAYTR_LIVE_ENABLED', 'PLATFORM_PAYTR_MERCHANT_ID', 'PLATFORM_PAYTR_MERCHANT_KEY', 'PLATFORM_PAYTR_MERCHANT_SALT', 'PLATFORM_PAYTR_USD_ENABLED', 'PLATFORM_PAYTR_ORIGIN', 'PLATFORM_BILLING_TERMS_URL'];
  const label = l('Ödeme (PayTR)', 'Payments (PayTR)');
  let config: ReturnType<typeof paytrConfiguration> | null = null; try { config = paytrConfiguration(); } catch { config = null; }
  const live = config ? paytrLiveReadiness(config) : null;
  if (live?.ready) return item('paytr', 'billing', 'ready', label, l('Canlı ödeme açık: peşin aylık veya yıllık dönem, kart saklanmaz. Plan yalnız imzalı ve tutarı tutan bildirimle açılır.', 'Live payments on: prepaid monthly or yearly periods, no stored cards. A plan opens only on a signed, amount-matching notice.'), env);
  if (live?.checks.gate) { const missing = (Object.entries(live.checks) as [string, boolean][]).filter(([, ok]) => !ok).map(([name]) => name).join(', ');
    return item('paytr', 'billing', 'missing', label, l(`Canlı ödeme anahtarı açık ama eksik: ${missing}.`, `The live switch is on but these are missing: ${missing}.`), env); }
  return item('paytr', 'billing', config?.readiness.ready ? 'warning' : 'off', label, config?.readiness.ready ? l('Yalnız sandbox: gerçek ödeme alınmaz.', 'Sandbox only: no real payment is taken.') : l('Kapalı.', 'Off.'), env);
}
export function operatorReadiness(db: Database.Database): ReadinessSnapshot {
  const encryption = process.env.PLATFORM_ENCRYPTION_KEY || '';
  const keyFile = join(dirname(process.env.PLATFORM_DATABASE_PATH || join(process.cwd(), 'data', 'platform.sqlite')), 'platform-credentials.key');
  const admin = process.env.ADMIN_PASSWORD || '', gemini = Boolean(process.env.PLATFORM_GEMINI_API_KEY && process.env.PLATFORM_GEMINI_MODEL);
  const items: ReadinessItem[] = [
    // Core
    item('auth-secret', 'core', (process.env.AUTH_SECRET || '').length >= 32 ? 'ready' : (process.env.AUTH_SECRET || '').length >= 16 ? 'warning' : 'missing',
      l('Oturum imza anahtarı', 'Session signing secret'), l('En az 32 karakterlik rastgele bir değer olmalı.', 'Must be a random value of at least 32 characters.'), ['AUTH_SECRET']),
    item('admin-password', 'core', admin.length >= 16 ? 'ready' : admin ? 'warning' : 'missing',
      l('Yönetici şifresi', 'Administrator password'), l('En az 16 karakter, başka hiçbir yerde kullanılmayan bir şifre. Eski varsayılan değer kesinlikle değiştirilmeli.', 'At least 16 characters, used nowhere else. The old default must be changed.'), ['ADMIN_PASSWORD']),
    item('encryption-key', 'core', /^[a-f0-9]{64}$/i.test(encryption) ? 'ready' : existsSync(keyFile) ? 'warning' : 'missing',
      l('Bağlantı şifreleme anahtarı', 'Connection encryption key'),
      /^[a-f0-9]{64}$/i.test(encryption) ? l('Ortam değişkeninden okunuyor.', 'Read from the environment.') : l('Anahtar data/ klasöründeki bir dosyada. Dosya kaybolursa müşterilerin bütün bağlantıları okunamaz; değeri güvenli bir yere yedekleyip PLATFORM_ENCRYPTION_KEY olarak tanımlayın.', 'The key lives in a file under data/. If the file is lost, every customer connection becomes unreadable; back up the value and set it as PLATFORM_ENCRYPTION_KEY.'), ['PLATFORM_ENCRYPTION_KEY']),
    item('cron-secret', 'core', (process.env.CRON_SECRET || '').length >= 16 ? 'ready' : 'missing',
      l('Zamanlanmış işler anahtarı', 'Scheduled job secret'), l('Worker ve zamanlanmış rotalar bu anahtarla çağrılır; sunucu crontab’ı da tanımlı olmalı.', 'The worker and scheduled routes are called with this secret; the server crontab must also be set.'), ['CRON_SECRET']),
    item('app-url', 'core', https(process.env.NEXT_PUBLIC_APP_URL) ? 'ready' : 'missing',
      l('Uygulamanın genel adresi', 'Public app address'), l('Canlıda https olmalı. Abonelikten çıkma, tıklama izleme ve e-posta bağlantıları bu adresi kullanır.', 'Must be https in production. Unsubscribe, click tracking and email links use it.'), ['NEXT_PUBLIC_APP_URL']),
    item('public-origin', 'core', publicEmailOrigin() ? 'ready' : 'missing',
      l('Ryzevo genel kökü', 'Ryzevo public origin'), l('Müşteri e-postalarındaki çıkma bağlantıları ve sağlayıcıların çektiği görseller için https kök adres.', 'The https origin for unsubscribe links in customer emails and for images providers fetch.'), ['PLATFORM_PUBLIC_ORIGIN']),
    item('signup', 'core', on('PLATFORM_PUBLIC_SIGNUP_ENABLED') ? (identityEmailConfiguration() ? 'ready' : 'missing') : 'off',
      l('Herkese açık kayıt', 'Public signup'), on('PLATFORM_PUBLIC_SIGNUP_ENABLED') ? (identityEmailConfiguration() ? l('Açık; doğrulama e-postaları gönderilebilir.', 'On; verification emails can be sent.') : l('Açık ama doğrulama e-postası ayarları eksik; kimse kaydı tamamlayamaz.', 'On, but verification email settings are missing; nobody can finish signing up.')) : l('Kapalı; hesaplar yalnız davetle açılır.', 'Off; accounts open by invitation only.'),
      ['PLATFORM_PUBLIC_SIGNUP_ENABLED', 'PLATFORM_AUTH_EMAIL_ENABLED', 'PLATFORM_AUTH_ORIGIN', 'PLATFORM_AUTH_FROM_EMAIL', 'PLATFORM_AUTH_SES_REGION', 'PLATFORM_AUTH_SES_ACCESS_KEY_ID', 'PLATFORM_AUTH_SES_SECRET_ACCESS_KEY']),
    // Email
    toggle('email-send', 'email', 'PLATFORM_EMAIL_PILOT_SEND_ENABLED', l('Gerçek e-posta gönderimi', 'Real email sending'), l('Açık; onaylı pilotlar müşterinin kendi SES hesabından gider.', 'On; approved pilots go out from the customer’s own SES account.'), l('Kapalı; yalnız prova yapılır.', 'Off; rehearsal only.')),
    item('ses-feedback', 'email', process.env.SES_SNS_TOPIC_ARN ? 'ready' : 'missing',
      l('Geri dönen ve şikâyet bildirimleri (Crewin)', 'Bounce and complaint notices (Crewin)'), l('Eski Crewin paneli için SES → SNS konusu; şikâyet edenler listeden çıkarılır.', 'SES → SNS topic for the legacy Crewin panel; complainers are removed from lists.'), ['SES_SNS_TOPIC_ARN']),
    // Social
    item('meta', 'social', works(metaConfiguration) ? 'ready' : 'missing', l('Meta uygulaması (Facebook, Instagram)', 'Meta app (Facebook, Instagram)'), l('Müşteriler sayfalarını ve Instagram hesaplarını bu uygulamayla bağlar.', 'Customers connect Pages and Instagram accounts through this app.'), ['PLATFORM_META_APP_ID', 'PLATFORM_META_APP_SECRET', 'PLATFORM_META_REDIRECT_URI', 'PLATFORM_META_GRAPH_VERSION']),
    item('meta-webhook', 'social', metaInboxHookConfigured() ? 'ready' : 'off', l('Anlık yorum ve mesaj bildirimi', 'Instant comment and message notices'), l('/api/platform/meta/hooks; Meta uygulamasında webhook alanları açık ve uygulama Live olmalı.', '/api/platform/meta/hooks; webhook fields must be on in the Meta app and the app must be Live.'), ['PLATFORM_META_APP_SECRET', 'PLATFORM_META_WEBHOOK_VERIFY_TOKEN']),
    item('linkedin', 'social', works(linkedinConfiguration) ? 'ready' : 'missing', l('LinkedIn uygulaması (kişisel profil)', 'LinkedIn app (personal profile)'), l('Kişisel profil bağlantısı ve paylaşımı.', 'Personal profile connection and posting.'), ['PLATFORM_LINKEDIN_CLIENT_ID', 'PLATFORM_LINKEDIN_CLIENT_SECRET', 'PLATFORM_LINKEDIN_REDIRECT_URI']),
    item('linkedin-company', 'social', works(linkedinOrganizationConfiguration) ? 'ready' : 'missing', l('LinkedIn şirket sayfaları', 'LinkedIn company pages'), l('Şirket sayfası bağlantısı için ayrıca API sürümü (YYYYMM) gerekir.', 'Company pages also need the API version (YYYYMM).'), ['PLATFORM_LINKEDIN_API_VERSION']),
    item('x', 'social', works(xConfiguration) ? 'ready' : 'missing', l('X uygulaması', 'X app'), l('X erişimi yaklaşık iki saatte dolar; müşteri gerektiğinde yeniden bağlar.', 'X access expires after about two hours; customers reconnect when needed.'), ['PLATFORM_X_CLIENT_ID', 'PLATFORM_X_CLIENT_SECRET', 'PLATFORM_X_REDIRECT_URI']),
    item('google', 'social', works(googleConfiguration) ? 'ready' : 'missing', l('Google uygulaması (GA4, Search Console, Google Ads)', 'Google app (GA4, Search Console, Google Ads)'), l('Ölçüm ve SEO verisi için Google OAuth.', 'Google OAuth for measurement and SEO data.'), ['PLATFORM_GOOGLE_CLIENT_ID', 'PLATFORM_GOOGLE_CLIENT_SECRET', 'PLATFORM_GOOGLE_REDIRECT_URI']),
    toggle('social-publish', 'social', 'PLATFORM_SOCIAL_PUBLISH_ENABLED', l('Gerçek sosyal yayın ve yanıt', 'Real social publishing and replies'), l('Açık; onaylı yayınlar ve yanıtlar gider.', 'On; approved posts and replies go out.'), l('Kapalı; yalnız prova yapılır.', 'Off; rehearsal only.')),
    // Messaging
    toggle('whatsapp-send', 'messaging', 'PLATFORM_WHATSAPP_SEND_ENABLED', l('Gerçek WhatsApp gönderimi', 'Real WhatsApp sending'), l('Açık; onaylı şablon gönderileri gider. Meta her mesajı ücretlendirir.', 'On; approved template batches go out. Meta bills each message.'), l('Kapalı; yalnız prova yapılır.', 'Off; rehearsal only.')),
    // Ads
    toggle('ads', 'ads', 'PLATFORM_ADS_ENABLED', l('Reklam kampanyası oluşturma', 'Ad campaign creation'), l('Açık; onaylı planlar sağlayıcıda duraklatılmış olarak oluşturulur.', 'On; approved plans are created paused at the provider.'), l('Kapalı.', 'Off.')),
    item('google-ads', 'ads', googleAdsConfigured() ? 'ready' : 'missing', l('Google Ads geliştirici anahtarı', 'Google Ads developer token'), l('Google Ads API erişimi için Ryzevo’nun onaylı geliştirici anahtarı.', 'Ryzevo’s approved developer token for Google Ads API access.'), ['PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN']),
    // AI
    item('gemini', 'ai', gemini ? 'ready' : 'missing', l('AI sağlayıcısı (Gemini)', 'AI provider (Gemini)'), gemini ? l('Tanımlı. "Dene" ile anahtarın ve modelin çalıştığını doğrulayabilirsiniz; içerik üretilmez.', 'Set. "Check" confirms the key and model work; no content is generated.') : l('Tanımlı değil; teşhis ve öneriler kural tabanlı çalışır.', 'Not set; diagnosis and suggestions use the rule-based path.'), ['PLATFORM_GEMINI_API_KEY', 'PLATFORM_GEMINI_MODEL'], gemini ? 'gemini' : undefined),
    // Billing
    paytrItem(),
  ];
  // Customer connections in standard projects: how many are active and how many passed a publish check this week.
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const connections = db.prepare(`SELECT COALESCE(s.platform,c.provider) provider,COUNT(*) active,COUNT(DISTINCT c.project_id) projects,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM platform_social_publish_checks k WHERE k.connection_id=c.id AND k.checked_at>=?) THEN 1 ELSE 0 END) checkedRecently
    FROM platform_connections c JOIN platform_projects p ON p.id=c.project_id AND p.organization_id=c.organization_id
    LEFT JOIN platform_social_accounts s ON s.connection_id=c.id
    WHERE c.active=1 AND p.product_pack='standard' GROUP BY COALESCE(s.platform,c.provider) ORDER BY active DESC`).all(week) as ConnectionHealth[];
  return {
    generatedAt: new Date().toISOString(), items, connections,
    webhooks: [
      { path: '/api/platform/meta/hooks', label: l('Meta yorum ve mesajları', 'Meta comments and messages') },
      { path: '/api/platform/billing/paytr/notify', label: l('PayTR ödeme bildirimi', 'PayTR payment notice') },
      { path: '/api/platform/worker', label: l('Worker (CRON_SECRET ile, birkaç dakikada bir)', 'Worker (with CRON_SECRET, every few minutes)') },
    ],
  };
}

// Read-only check that the AI key and model answer; it asks for the model's description, not for content.
export type ProbeFetch = (url: string, init: RequestInit) => Promise<{ status: number }>;
export async function probeGemini(fetcher: ProbeFetch = (url, init) => fetch(url, init)): Promise<ProbeResult> {
  const key = process.env.PLATFORM_GEMINI_API_KEY || '', model = process.env.PLATFORM_GEMINI_MODEL || '', checkedAt = new Date().toISOString();
  if (!key || !/^[A-Za-z0-9._-]{1,80}$/.test(model)) return { id: 'gemini', ok: false, status: null, checkedAt };
  try {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { headers: { 'x-goog-api-key': key, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    return { id: 'gemini', ok: response.status === 200, status: response.status, checkedAt };
  } catch { return { id: 'gemini', ok: false, status: null, checkedAt }; }
}

// Funnel over standard projects created in the last `days` days. A project counts for a step when it reached it;
// it is "stalled" at a step when it reached it, did not reach the next one and is older than `stalledAfterDays`.
export function operatorFunnel(db: Database.Database, days = 90, stalledAfterDays = 3): FunnelSnapshot {
  const since = new Date(Date.now() - days * 86400000).toISOString(), stale = new Date(Date.now() - stalledAfterDays * 86400000).toISOString();
  const rows = db.prepare(`SELECT o.created_at created,
      EXISTS(SELECT 1 FROM platform_growth_coach g WHERE g.organization_id=p.organization_id AND g.project_id=p.id) diagnosis,
      EXISTS(SELECT 1 FROM platform_growth_coach g WHERE g.organization_id=p.organization_id AND g.project_id=p.id AND g.approved_at IS NOT NULL) brief,
      EXISTS(SELECT 1 FROM platform_compass_preferences c WHERE c.organization_id=p.organization_id AND c.project_id=p.id AND c.deferred=0) path,
      EXISTS(SELECT 1 FROM platform_connections c WHERE c.organization_id=p.organization_id AND c.project_id=p.id AND c.active=1) connection,
      (EXISTS(SELECT 1 FROM platform_social_publications s WHERE s.organization_id=p.organization_id AND s.project_id=p.id AND s.mode='rehearsal' AND s.state='rehearsed')
        OR EXISTS(SELECT 1 FROM platform_email_pilots e JOIN platform_jobs j ON j.id=e.job_id WHERE e.organization_id=p.organization_id AND e.project_id=p.id AND e.mode='rehearsal' AND j.status='completed')
        OR EXISTS(SELECT 1 FROM platform_whatsapp_batches w WHERE w.organization_id=p.organization_id AND w.project_id=p.id AND w.mode='rehearsal' AND w.state='done')) rehearsal,
      (EXISTS(SELECT 1 FROM platform_social_publications s WHERE s.organization_id=p.organization_id AND s.project_id=p.id AND s.mode='publish' AND s.state='accepted')
        OR EXISTS(SELECT 1 FROM platform_email_send_reservations r WHERE r.organization_id=p.organization_id AND r.project_id=p.id AND r.submitted_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM platform_whatsapp_messages m JOIN platform_whatsapp_batches w ON w.id=m.batch_id WHERE w.organization_id=p.organization_id AND w.project_id=p.id AND m.state='accepted')) live
    FROM platform_projects p JOIN platform_organizations o ON o.id=p.organization_id
    WHERE p.product_pack='standard' AND o.created_at>=?`).all(since) as (Record<Exclude<FunnelStep, 'created'>, number> & { created: string })[];
  const reached = (row: (typeof rows)[number], step: FunnelStep) => step === 'created' || row[step] === 1;
  const steps = FUNNEL_STEPS.map((id, index) => {
    const next = FUNNEL_STEPS[index + 1], hit = rows.filter(row => reached(row, id));
    return { id, reached: hit.length, stalled: next ? hit.filter(row => !reached(row, next) && row.created < stale).length : 0 };
  });
  const now = new Date().toISOString();
  const trial = db.prepare(`SELECT SUM(CASE WHEN e.mode='trial' AND e.ends_at>? THEN 1 ELSE 0 END) active,SUM(CASE WHEN e.mode='trial' AND e.ends_at<=? THEN 1 ELSE 0 END) ended,SUM(CASE WHEN e.mode='pilot' THEN 1 ELSE 0 END) pilot
    FROM platform_project_entitlements e JOIN platform_projects p ON p.id=e.project_id AND p.organization_id=e.organization_id WHERE p.product_pack='standard'`).get(now, now) as { active: number | null; ended: number | null; pilot: number | null };
  return { generatedAt: now, days, stalledAfterDays, steps, trials: { active: trial.active || 0, ended: trial.ended || 0, pilot: trial.pilot || 0 } };
}
