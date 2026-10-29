import 'server-only';
import path from 'path';
import { fileSummary, resetFileSummaries } from './file-summary';
import type { LocalizedText } from './catalog';
import type { JobGuideItem, JobGuideView, JobId, JobStep } from './job-guide-types';
import type Database from 'better-sqlite3';

// "What would you like to do?" for the Crewin workspace. Its legacy tabs keep their records in JSON files (web data/,
// agent data/) and in the Crewin backend, not in the platform tables, so the steps are read from there. A step is done
// only when a record shows it; weekly work (posting, reporting) counts from the last 7 days, so it comes back each week.
// Each step links to the exact sub-tab (?view=, ?section=) and names the button to press.

const l = (tr: string, en: string): LocalizedText => ({ tr, en });
const DAY = 86_400_000, WEEK = 7 * DAY, MONTH = 30 * DAY;
export type CrewinGuideDeps = {
  webData: string; agentRoot: string; now: number; env: Record<string, string | undefined>;
  // Agent .env merged with the process env (TG_SESSION lives there).
  agentEnv: () => Record<string, string>;
  socialConnected: () => string[];
  // Crewin backend reads; each may fail or time out on its own without hiding the other jobs.
  stats: () => Promise<CrewinStats>;
  leads: () => Promise<unknown>;
  pendingOrders: () => Promise<unknown>;
  campaigns: () => Promise<unknown>;
  posts: () => Promise<unknown>;
  // The platform database: Ryzevo's features in the Crewin workspace (coach, SEO automation, AI visibility, inbox, reports).
  db?: Database.Database;
};
export type CrewinStats = { seafarers?: { newThisWeek?: number; fillRateBuckets?: { zero?: number; low?: number } }; jobs?: { newThisWeek?: number | null } };

// Backend answers, shared by concurrent requests (file summaries live in ./file-summary).
const g = globalThis as typeof globalThis & { __crewinGuideRemote?: Map<string, { at: number; ok: boolean; value: unknown; pending?: Promise<unknown> }> };
const remote = g.__crewinGuideRemote ?? (g.__crewinGuideRemote = new Map());
const summary = <T,>(file: string, empty: T, reduce: (data: unknown) => T) => fileSummary(file, empty, reduce, 'job-guide');
// Backend reads: one call per minute at most (15 s after a failure), shared by concurrent requests, bounded by a timeout.
async function cached(name: string, now: number, read: () => Promise<unknown>, timeoutMs = 8000): Promise<{ ok: boolean; value: unknown }> {
  const hit = remote.get(name);
  if (hit && !hit.pending && now - hit.at < (hit.ok ? 60_000 : 15_000)) return hit;
  if (hit?.pending) { await hit.pending.catch(() => undefined); return remote.get(name) || { ok: false, value: null }; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]).finally(() => clearTimeout(timer));
  remote.set(name, { at: now, ok: false, value: null, pending });
  try { const value = await pending; remote.set(name, { at: now, ok: true, value }); } catch { remote.set(name, { at: now, ok: false, value: null }); }
  return remote.get(name)!;
}
export function resetCrewinGuideCache() { resetFileSummaries(); remote.clear(); }

const time = (value: unknown) => { const n = typeof value === 'number' ? value : Date.parse(String(value || '')); return Number.isFinite(n) ? n : 0; };
const list = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  if (!value || typeof value !== 'object') return [];
  const root = value as Record<string, unknown>, inner = root.result && typeof root.result === 'object' ? root.result as Record<string, unknown> : root;
  if (Array.isArray(root.result)) return list(root.result);
  for (const key of ['items', 'kayitlar', 'prospects', 'leads', 'data']) if (Array.isArray(inner[key])) return list(inner[key]);
  return [];
};
const total = (value: unknown) => {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}, inner = root.result && typeof root.result === 'object' && !Array.isArray(root.result) ? root.result as Record<string, unknown> : root;
  const n = Number(inner.totalCount ?? inner.toplamKayit); return Number.isFinite(n) && n >= 0 ? n : list(value).length;
};
const number = (n: number) => ({ tr: n.toLocaleString('tr-TR'), en: n.toLocaleString('en-US') });
function ago(at: number, now: number): LocalizedText {
  const days = Math.floor((now - at) / DAY);
  return days <= 0 ? l('bugün', 'today') : days === 1 ? l('dün', 'yesterday') : l(`${days} gün önce`, `${days} days ago`);
}
const last = (prefix: LocalizedText, at: number, now: number): LocalizedText | null => at ? l(`${prefix.tr}: ${ago(at, now).tr}`, `${prefix.en}: ${ago(at, now).en}`) : null;
const join = (...parts: (LocalizedText | null | undefined)[]): LocalizedText | null => { const shown = parts.filter(Boolean) as LocalizedText[]; return shown.length ? l(shown.map(p => p.tr).join(' · '), shown.map(p => p.en).join(' · ')) : null; };

// Content history: newest timestamp per kind of generated content (the tab writes the kind into platform or prompt).
type ContentKinds = Record<'social' | 'growth' | 'retention' | 'blog' | 'kpi', number>;
const SOCIAL = new Set(['instagram', 'facebook', 'linkedin', 'twitter', 'x', 'tiktok', 'telegram']);
function contentKinds(data: unknown): ContentKinds {
  const out: ContentKinds = { social: 0, growth: 0, retention: 0, blog: 0, kpi: 0 };
  for (const item of list(data)) {
    const at = time(item.timestamp), platform = String(item.platform || '').toLowerCase(), prompt = String(item.prompt || '');
    const kind: keyof ContentKinds | null = platform === 'kpi' ? 'kpi' : platform === 'blog' ? 'blog' : /^Retention ·/.test(prompt) ? 'retention'
      : /^Seafarer (Büyüme|Growth)/.test(prompt) ? 'growth' : SOCIAL.has(platform) && !/^(Reklam Kampanyası|Ad Campaign|Mesajlaşma)/.test(prompt) ? 'social' : null;
    if (kind && at > out[kind]) out[kind] = at;
    if (kind === 'growth' && at > out.social) out.social = at;
  }
  return out;
}

export async function crewinJobGuide(deps: CrewinGuideDeps): Promise<JobGuideView> {
  const { now, env } = deps, web = (name: string) => path.join(deps.webData, name), agent = (...name: string[]) => path.join(deps.agentRoot, ...name);
  const [stats, leads, orders, campaigns, posts] = await Promise.all([
    cached('stats', now, deps.stats), cached('leads', now, deps.leads), cached('orders', now, deps.pendingOrders), cached('campaigns', now, deps.campaigns), cached('posts', now, deps.posts),
  ]);
  const content = summary(web('content-history.json'), contentKinds(null), contentKinds);
  const activity = summary(web('activity-log.json'), [] as { type: string; ts: number }[], data => list(data).map(item => ({ type: String(item.type || ''), ts: time(item.ts) })));
  const lastActivity = (...types: string[]) => activity.reduce((max, item) => types.includes(item.type) && item.ts > max ? item.ts : max, 0);
  const review = summary(agent('data', 'review-queue.json'), [] as number[], data => list(data).filter(item => (item.status || 'pending') === 'pending').map(item => time(item.queuedAt)));
  const posted = summary(agent('data', 'posted-jobs.json'), { posted: [] as number[], broadcast: 0 }, data => {
    const rows = list(data); return { posted: rows.map(item => time(item.postedAt)).filter(Boolean), broadcast: rows.reduce((max, item) => Math.max(max, time(item.broadcastedAt)), 0) };
  });
  const queue = summary(agent('job-queue.json'), { pending: 0, posted: [] as number[] }, data => {
    const rows = list(data); return { pending: rows.filter(item => item.status === 'pending').length, posted: rows.filter(item => item.status === 'posted').map(item => time(item.postedAt)) };
  });
  const scheduledFailed = summary(web('scheduled-posts.json'), 0, data => list(data).filter(item => item.status === 'failed' || item.status === 'partial').length);
  const seoItems = summary(web('seo-work-items.json'), { proposed: 0, approved: 0, applied: 0, any: 0 }, data => {
    const rows = list(data); return { proposed: rows.filter(item => item.status === 'proposed').length, approved: rows.filter(item => item.status === 'approved').length, applied: rows.filter(item => item.status === 'applied').length, any: rows.length };
  });
  const localPosts = summary(web('post-history.json'), 0, data => list(data).reduce((max, item) => Math.max(max, time(item.publishedAt)), 0));

  const jobs: Omit<JobGuideItem, 'done' | 'total' | 'nextStepId' | 'complete' | 'relevance'>[] = [];
  const unavailable: LocalizedText[] = [];
  const step = (id: string, label: LocalizedText, detail: LocalizedText, done: boolean, tab: string, setup: LocalizedText | null = null, evidence: LocalizedText | null = null): JobStep =>
    ({ id, label, detail, state: done ? 'done' : setup ? 'blocked' : 'todo', href: `/?tab=${tab}`, canAct: !done && !setup, reason: done ? null : setup, evidence });
  const SERVER = (what: string, whatEn: string) => l(`Sunucu ayarı eksik: ${what}. Ayar .env.local dosyasına eklenip uygulama yeniden başlatılınca bu adım açılır; önceki adımları şimdiden yapabilirsiniz.`, `Server setting missing: ${whatEn}. Once it is added to .env.local and the app restarted, this step opens; you can do the earlier steps now.`);
  // Steps waiting for Ryzevo's server-side connections link to the setup guide card (Project settings → Operations).
  const SETUP = (id: 'google' | 'meta' | 'gemini' | 'worker') => `/?tab=project&settings=operations&setup=${id}`;
  const withSetup = (item: JobStep, id: 'google' | 'meta' | 'gemini' | 'worker') => item.state === 'blocked' ? { ...item, setupHref: SETUP(id) } : item;

  // 1. Job ads: the review queue the Telegram bot fills, publishing on crewinjob.com, announcing in Telegram groups.
  {
    const fresh = review.filter(at => now - at < WEEK).length, stale = review.length - fresh;
    const jobPosts = [...posted.posted, ...queue.posted, lastActivity('job_posted')].filter(at => now - at < WEEK), lastPost = Math.max(0, ...posted.posted, ...queue.posted, lastActivity('job_posted'));
    const siteNew = stats.ok ? Number((stats.value as CrewinStats).jobs?.newThisWeek ?? NaN) : NaN;
    const tg = deps.agentEnv();
    jobs.push({ id: 'crewin_jobs', title: l('İlan yayınla ve Telegram’da duyur', 'Post jobs and announce them on Telegram'), outcome: l('Yeni ilanların crewinjob.com’da yayınlanması ve gemi adamlarının bulunduğu Telegram gruplarında duyurulması.', 'New job ads published on crewinjob.com and announced in the Telegram groups where seafarers are.'),
      keywords: ['ilan', 'iş ilanı', 'job', 'vacancy', 'yayınla', 'publish', 'telegram', 'grup', 'group', 'duyur', 'announce', 'broadcast', 'kuyruk', 'queue', 'inceleme', 'review', 'bot', 'otomasyon', 'pipeline'],
      badge: fresh + queue.pending ? { count: fresh + queue.pending, label: l('ilan onay bekliyor', 'job ad(s) awaiting approval') } : null,
      steps: [
        step('review', l('Botun bulduğu yeni ilanları inceleyin', 'Review the job ads the bot found'), l('Otomasyon → 🔍 İnceleme Kuyruğu’nda her ilanı okuyun: ✅ Onayla ilanı crewinjob.com’da yayınlar, ❌ Reddet kuyruktan çıkarır. Son 7 günde bulunan ilan kalmayınca tamamlanır.', 'In Automation → 🔍 Review queue, read each ad: ✅ Approve publishes it on crewinjob.com, ❌ Reject removes it. Done when no ad found in the last 7 days is left.'), fresh === 0, 'pipeline&view=review', null,
          join(fresh ? l(`Son 7 günde bulunan ${number(fresh).tr} ilan bekliyor`, `${number(fresh).en} ad(s) found in the last 7 days waiting`) : null, stale ? l(`${number(stale).tr} eski kayıt da kuyrukta; artık gerekmiyorsa aynı ekranda “Tümünü Temizle” ile boşaltılabilir`, `${number(stale).en} older item(s) are queued too; if no longer needed, “Clear all” on the same screen empties them`) : null)),
        step('publish', l('Bu hafta ilan yayınlayın', 'Publish a job ad this week'), l('İlan botu → ✏️ İlan Oluştur’da ilan metnini yapıştırıp alanları kontrol edin ve 🚀 Hemen Yayınla’ya basın; ya da 📥 Kuyruğa Ekle ile sıraya alıp 📥 Kuyruk’ta 🚀 Onayla & Yayınla deyin. İlan crewinjob.com’da hemen görünür.', 'In Job bot → ✏️ Create, paste the ad text, check the fields and press 🚀 Publish now; or queue it with 📥 Add to queue and press 🚀 Approve & publish in 📥 Queue. The ad appears on crewinjob.com at once.'), jobPosts.length > 0, 'jobbot&view=create', null,
          join(jobPosts.length ? l(`Son 7 günde ${number(jobPosts.length).tr} ilan yayınladınız`, `You published ${number(jobPosts.length).en} ad(s) in the last 7 days`) : last(l('Son ilan', 'Last ad'), lastPost, now), Number.isFinite(siteNew) ? l(`sitede bu hafta toplam ${number(siteNew).tr} yeni ilan`, `${number(siteNew).en} new ad(s) on the site this week`) : null)),
        step('broadcast', l('Yeni ilanları Telegram gruplarında duyurun', 'Announce the new ads in Telegram groups'), l('Otomasyon → “Paylaş” kartı (Yeni ilanları Telegram’da duyur) son yayınlanan ve henüz duyurulmamış ilanları katıldığınız gruplara gönderir; grup başına günlük sınır vardır. Gönderilen mesaj geri alınamaz, önce İlan botu → ✅ Yayınlananlar’da listeyi kontrol edin.', 'Automation → the “Share” card (announce new ads on Telegram) sends the recently published, not yet announced ads to the groups you joined, with a daily limit per group. Sent messages cannot be withdrawn; check the list in Job bot → ✅ Published first.'), now - posted.broadcast < WEEK, 'pipeline',
          tg.TG_SESSION ? null : SERVER('Telegram oturumu (TG_SESSION) — Telegram botu → “+ Oturum ekle” ile eklenir', 'the Telegram session (TG_SESSION), added in Telegram bot → “+ Add session”'), last(l('Son duyuru', 'Last announcement'), posted.broadcast, now)),
      ] });
  }

  // 2. Profile completion: empty profiles are the largest group; a reminder by missing field, then sending it.
  {
    const buckets = stats.ok ? (stats.value as CrewinStats).seafarers?.fillRateBuckets : undefined, empty = Number(buckets?.zero ?? NaN);
    const emailReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM_EMAIL), waReady = Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
    const sent = lastActivity('email_sent', 'wa_sent');
    jobs.push({ id: 'crewin_profiles', title: l('Boş profilleri doldurt', 'Get empty profiles completed'), outcome: l('Profili boş veya eksik gemi adamlarının profilini tamamlaması; firmalar yalnız dolu profilleri bulup CV açar.', 'Seafarers with empty or partial profiles completing them; companies only find and unlock full profiles.'),
      keywords: ['profil', 'profile', 'boş profil', 'eksik', 'doluluk', 'aktivasyon', 'activation', 'retention', 'elde tutma', 'hatırlatma', 'reminder', 're-aktivasyon', 'reactivation', 'e-posta', 'email', 'whatsapp', 'gemi adamı', 'seafarer'],
      badge: Number.isFinite(empty) && empty > 0 ? { count: empty, label: l('boş profil', 'empty profile(s)') } : null,
      steps: [
        step('content', l('Eksik alana göre hatırlatma metni hazırlayın', 'Prepare a reminder for the missing field'), l('Elde tutma’da bir segment seçin (ör. sertifikası eksik olanlar) ve “Retention İçeriği Üret”e basın. Metin İçerik kütüphanesine kaydedilir; hiçbir şey gönderilmez.', 'In Retention, pick a segment (e.g. missing certificates) and press “Generate retention content”. The text is saved in the content library; nothing is sent.'), now - content.retention < MONTH, 'retention', null, last(l('Son metin', 'Last text'), content.retention, now)),
        step('send', l('Hatırlatmayı gönderin', 'Send the reminder'), l('WA & Telegram → Mevcut Kullanıcı (Gönder) → “E-posta Re-aktivasyon”da 📥 Segmentten Yükle ile alıcıları getirin, metni kontrol edip “📧 Kampanyayı Gönder”e basın (WhatsApp için “WA Bildirim Gönder”). Gönderim geri alınamaz; abonelikten çıkanlara gitmez.', 'In WA & Telegram → Existing users (Send) → “Email re-activation”, load recipients with 📥 Load from segment, check the text and press “📧 Send campaign” (for WhatsApp, “Send WA notification”). Sending cannot be undone; unsubscribed people are skipped.'), now - sent < MONTH, 'messaging&view=notify_email',
          emailReady || waReady ? null : SERVER('e-posta (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL) veya WhatsApp (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)', 'email (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL) or WhatsApp (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)'), last(l('Son gönderim', 'Last send'), sent, now)),
        step('measure', l('Doluluğun değişimine bakın', 'Check how completion changed'), l('Gönderimden sonraki hafta “Haftalık KPI Raporu Üret” ile profil doluluğunu önceki raporla karşılaştırın (Geçmiş → Karşılaştırmak için seç).', 'The week after sending, compare profile completion with the previous report via “Generate weekly KPI report” (History → Select to compare).'), sent > 0 && content.kpi > sent, 'kpi', null,
          Number.isFinite(empty) ? l(`Şu an ${number(empty).tr} boş profil${buckets?.low ? `, ${number(Number(buckets.low)).tr} profil %50’nin altında` : ''}`, `${number(empty).en} empty profile(s) now${buckets?.low ? `, ${number(Number(buckets.low)).en} below 50%` : ''}`) : null),
      ] });
  }

  // 3. Social posts: account → post → published this week; registrations are what they bring.
  {
    const connected = deps.socialConnected(), backendPosts = posts.ok ? list(posts.value).reduce((max, item) => Math.max(max, time(item.publishedAt ?? item.creationTime)), 0) : 0;
    const lastPublished = Math.max(localPosts, backendPosts), signups = stats.ok ? Number((stats.value as CrewinStats).seafarers?.newThisWeek ?? NaN) : NaN;
    jobs.push({ id: 'crewin_social', title: l('Sosyal medyada paylaş, kayıt getir', 'Post on social media to bring sign-ups'), outcome: l('Kayıt çağrılı bir gönderinin Instagram, Facebook, LinkedIn, X veya TikTok’ta yayınlanması; yeni gemi adamı kayıtları buradan gelir.', 'A post with a sign-up call published on Instagram, Facebook, LinkedIn, X or TikTok; new seafarer sign-ups come from here.'),
      keywords: ['sosyal', 'social', 'paylaş', 'paylaşım', 'post', 'gönderi', 'instagram', 'facebook', 'linkedin', 'x', 'twitter', 'tiktok', 'kayıt', 'signup', 'gemi adamı', 'denizci', 'seafarer', 'yeni kullanıcı', 'zamanla', 'schedule'],
      badge: scheduledFailed ? { count: scheduledFailed, label: l('zamanlanmış paylaşım başarısız', 'scheduled post(s) failed') } : null,
      steps: [
        step('connect', l('Sosyal hesabı bağlayın', 'Connect a social account'), l('Sosyal medya’da bir içerik üretip “📤 Paylaş”ı açın; bağlı olmayan platformun yanındaki “Bağlan” düğmesiyle sağlayıcının kendi ekranında izin verin. Şifreniz bu panele girilmez.', 'In Social media, generate a post and open “📤 Share”; use “Connect” next to an unconnected platform and approve on the provider’s own screen. Your password is never typed here.'), connected.length > 0, 'social', null,
          connected.length ? l(`Bağlı: ${connected.join(', ')}`, `Connected: ${connected.join(', ')}`) : null),
        step('draft', l('Kayıt çağrılı gönderiyi hazırlayın', 'Prepare a post with a sign-up call'), l('Gemi adamı büyümesi → 🎯 Kayıt içeriği (veya 🎵 TikTok scripti) → “İçerik üret”; ya da Sosyal medya’da konu yazıp “İçerik Üret”. Taslak İçerik kütüphanesine kaydedilir.', 'In Seafarer growth → 🎯 Sign-up content (or 🎵 TikTok script) → “Generate”; or write a topic in Social media and press “Generate”. The draft is saved in the content library.'), now - content.social < WEEK, 'growth&view=registration', null, last(l('Son taslak', 'Last draft'), content.social, now)),
        step('publish', l('Bu hafta yayınlayın', 'Publish this week'), l('İçerik kütüphanesi’nde taslağı bulup “📤 Paylaş” → platformları seçin → “✅ Onayla ve N Platformda Paylaş”. İleri bir saate almak için “📅 Zamanla”yı kullanın. Paylaşım geri alınamaz.', 'Find the draft in the content library, then “📤 Share” → choose platforms → “✅ Approve and share on N platforms”. To set a later time, use “📅 Schedule”. Posting cannot be undone.'), now - lastPublished < WEEK, 'library',
          connected.length ? null : l('Önce bir sosyal hesap bağlanmalı (1. adım).', 'A social account must be connected first (step 1).'),
          join(last(l('Son yayın', 'Last post'), lastPublished, now), Number.isFinite(signups) ? l(`bu hafta ${number(signups).tr} yeni kayıt`, `${number(signups).en} new sign-up(s) this week`) : null)),
      ] });
  }

  // 4. Company leads (Crewin backend): research → decide each lead → reach the approved ones.
  if (leads.ok) {
    const rows = list(leads.value), status = (s: string) => rows.filter(item => String(item.status || 'review') === s).length;
    const inReview = status('review'), approved = status('approved'), reached = rows.filter(item => ['contacted', 'registered', 'job_posted', 'cv_unlocked'].includes(String(item.status))).length;
    const prospectCampaign = campaigns.ok && list(campaigns.value).some(item => JSON.stringify(item).includes('company_prospects'));
    jobs.push({ id: 'crewin_leads', title: l('Firma lead’i bul ve kampanyaya hazırla', 'Find company leads and prepare them for a campaign'), outcome: l('Gemi sahibi, işletmeci ve crewing ajanslarından doğrulanmış iletişim bilgisiyle onaylı lead’ler; ilk ilanı ve CV açma gelirini bunlar getirir.', 'Approved leads from ship owners, managers and crewing agencies with verified contacts; they bring first job posts and CV unlock revenue.'),
      keywords: ['lead', 'firma', 'company', 'şirket', 'prospect', 'müşteri', 'armatör', 'ship owner', 'crewing', 'ajans', 'agency', 'araştır', 'research', 'b2b', 'satış', 'sales', 'cv unlock'],
      badge: inReview ? { count: inReview, label: l('lead incelemede', 'lead(s) in review') } : null,
      steps: [
        step('research', l('Lead bulun', 'Find leads'), l('Kampanyalar → AI Prospect Finder → “AI ile araştır”da ülke ve şirket tipini seçip “AI araştırmasını başlat”a basın; tanıdığınız firmaları “Görüşme / lead ekle” ile ekleyin.', 'In Campaigns → AI Prospect Finder → “Research with AI”, choose country and company type and press “Start AI research”; add companies you know via “Add meeting / lead”.'), rows.length > 0, 'campaigns&view=prospects&section=research', null,
          rows.length ? l(`Havuzda ${number(rows.length).tr} lead`, `${number(rows.length).en} lead(s) in the pool`) : null),
        step('review', l('İncelemedeki lead’lere karar verin', 'Decide on the leads in review'), l('Lead havuzu’nda durumu “İncelenecek” olan her lead için “Onaylandı” ya da “Reddedildi”yi seçin. Alan adının e-posta sunucusu (MX) yoksa veya adres geçersizse onaylanamaz; info@/hr@ gibi rol adreslerine izin kontrolü yapın.', 'In Lead pool, set each lead whose status is “Review” to “Approved” or “Rejected”. A lead whose domain has no mail server (MX) or whose address is invalid cannot be approved; check consent for role addresses such as info@ or hr@.'), inReview === 0 && rows.length > 0, 'campaigns&view=prospects&section=pool', null,
          rows.length ? l(`${number(approved).tr} onaylı, ${number(inReview).tr} incelemede`, `${number(approved).en} approved, ${number(inReview).en} in review`) : null),
        step('campaign', l('Onaylı lead’lere ulaşın', 'Reach the approved leads'), l('Lead havuzu’nda “Onaylı lead’leri kampanyaya aktar” ile Kampanya akışlarında taslak açın, metni yazıp “Kampanyayı hazırla”; göndermek ayrı bir adımdır (“Şimdi başlat”).', 'In Lead pool, use “Move approved leads to a campaign” to open a draft in Campaign flows, write it and press “Prepare campaign”; sending is a separate step (“Start now”).'), prospectCampaign || reached > 0, 'campaigns&view=prospects&section=pool',
          approved || prospectCampaign || reached ? null : l('Önce en az bir lead onaylanmalı (2. adım).', 'At least one lead must be approved first (step 2).'),
          reached ? l(`${number(reached).tr} lead’e ulaşıldı`, `${number(reached).en} lead(s) reached`) : null),
      ] });
  } else unavailable.push(l('Firma lead’leri: Crewin lead servisi şu an yanıt vermiyor; Kampanyalar → AI Prospect Finder’dan doğrudan bakabilirsiniz.', 'Company leads: the Crewin lead service is not answering right now; you can look in Campaigns → AI Prospect Finder directly.'));

  // 5. Campaign flows (seafarers or companies): audience → draft → started.
  if (campaigns.ok) {
    const rows = list(campaigns.value), started = rows.filter(item => ['running', 'completed', 'partial'].includes(String(item.status || '').toLowerCase())).length;
    jobs.push({ id: 'crewin_campaign', title: l('E-posta / çok kanallı kampanya gönder', 'Send an email / multichannel campaign'), outcome: l('Seçilen gemi adamı veya firma kitlesine onaylı bir kampanyanın gitmesi ve dönüşümünün izlenmesi.', 'An approved campaign reaching a chosen seafarer or company audience, with its conversions tracked.'),
      keywords: ['kampanya', 'campaign', 'e-posta', 'email', 'mail', 'bülten', 'newsletter', 'kitle', 'audience', 'segment', 'toplu', 'bulk', 'gönder', 'send', 'duyuru'],
      badge: null,
      steps: [
        step('draft', l('Kampanyayı hazırlayın', 'Prepare the campaign'), l('Kampanyalar → Kampanya akışları → “Yeni kampanya”: hedef, kitle (doluluk, ülke, pozisyon) ve kanalları seçin, “Kitleyi hesapla” ile kaç kişiye gideceğini görün, metni yazıp “Kampanyayı hazırla”ya basın. Hazırlamak göndermek değildir.', 'In Campaigns → Campaign flows → “New campaign”: choose the goal, audience (completion, country, position) and channels, see the size with “Calculate audience”, write the text and press “Prepare campaign”. Preparing is not sending.'), rows.length > 0, 'campaigns&view=flows', null,
          rows.length ? l(`${number(rows.length).tr} kampanya kayıtlı`, `${number(rows.length).en} campaign(s) saved`) : null),
        step('start', l('Kontrol edip başlatın', 'Check and start it'), l('Kampanya kartında içerik ve kitleyi son kez kontrol edin; “Şimdi başlat” gönderimi başlatır ve geri alınamaz. İleri bir tarih için “Zamanla”yı kullanın; başarısız teslimatları “Başarısızları yeniden dene” ile tekrar deneyin.', 'Check content and audience one last time on the campaign card; “Start now” begins sending and cannot be undone. Use “Schedule” for a later date; retry failed deliveries with “Retry failed”.'), started > 0, 'campaigns&view=flows', null,
          started ? l(`${number(started).tr} kampanya başlatıldı`, `${number(started).en} campaign(s) started`) : null),
      ] });
  } else unavailable.push(l('Kampanyalar: kampanya servisi şu an yanıt vermiyor.', 'Campaigns: the campaign service is not answering right now.'));

  // 6. Google: site audit findings decided and applied, and a blog post that week by week brings search traffic.
  {
    const crawled = Math.max(lastActivity('seo_crawl_completed'), seoItems.any ? 1 : 0), blogPublished = lastActivity('blog_published');
    jobs.push({ id: 'crewin_seo', title: l('Google’da üst sıralara çık', 'Rank higher on Google'), outcome: l('crewinjob.com’un teknik sorunlarının giderilmesi ve düzenli blog yazılarıyla gemi adamlarının aramalarında görünmesi.', 'crewinjob.com’s technical issues fixed and regular blog posts showing up in seafarers’ searches.'),
      keywords: ['seo', 'google', 'arama', 'search', 'sıralama', 'ranking', 'blog', 'makale', 'article', 'site', 'denetim', 'audit', 'keyword', 'anahtar kelime', 'organik', 'ctr'],
      badge: seoItems.proposed ? { count: seoItems.proposed, label: l('SEO önerisi karar bekliyor', 'SEO suggestion(s) awaiting a decision') } : null,
      steps: [
        step('audit', l('Siteyi denetleyin', 'Audit the site'), l('SEO & Blog → Site Denetimi’nde “Site taramasını başlat”a basın; bulunan sorunları “Öneriye ekle” ile iş listesine alın.', 'In SEO & Blog → Site audit, press “Start site crawl”; add the issues found to the work list with “Add as suggestion”.'), crawled > 0, 'seo&view=site_audit', null, null),
        step('decide', l('Önerilere karar verin', 'Decide on the suggestions'), l('Site Denetimi’ndeki iş listesinde her öneriyi “Onayla” veya “Reddet”; onaylananı geliştiriciye verip uygulanınca “Manuel uygulamayı kaydet”e basın. Panel sitenizi kendisi değiştirmez.', 'In the Site audit work list, “Approve” or “Reject” each suggestion; give approved ones to the developer and press “Record manual fix” once applied. The panel never changes your site itself.'), seoItems.any > 0 && seoItems.proposed === 0 && seoItems.approved === 0, 'seo&view=site_audit', null,
          seoItems.any ? l(`${number(seoItems.proposed).tr} karar bekliyor, ${number(seoItems.approved).tr} onaylı uygulanmayı bekliyor, ${number(seoItems.applied).tr} uygulandı`, `${number(seoItems.proposed).en} awaiting a decision, ${number(seoItems.approved).en} approved awaiting the fix, ${number(seoItems.applied).en} applied`) : null),
        step('blog', l('Bu ay blog yazısı yayınlayın', 'Publish a blog post this month'), l('SEO & Blog → Blog Makalesi’nde konuyu yazıp “Makale Üret”, metni okuyup düzeltin ve “🚀 Blogu Yayınla”ya basın; yazı görseliyle crewinjob.com/blog’da yayınlanır.', 'In SEO & Blog → Blog article, enter the topic and press “Generate article”, read and edit it, then press “🚀 Publish blog”; it goes live with its image on crewinjob.com/blog.'), now - blogPublished < MONTH, 'seo&view=blog', null,
          join(last(l('Son yayın', 'Last published'), blogPublished, now), !blogPublished ? last(l('Son blog taslağı', 'Last blog draft'), content.blog, now) : null)),
      ] });
  }

  // Ryzevo's records for the Crewin project (empty until a Ryzevo feature is used there).
  const db = deps.db, CREWIN = ['crewin', 'crewinjob'] as const;
  const rows = (sql: string, ...values: unknown[]) => { try { return (db!.prepare(sql).get(...CREWIN, ...values) as { n: number } | undefined)?.n || 0; } catch { return 0; } };
  const monthly = db ? step('monthly', l('Aylık raporu onaylayın', 'Approve the monthly report'), l('Ay bitince Analitik’in altındaki “Aylık rapor” hazırlanır; okuyup onaylayın, isterseniz süreli bir bağlantıyla paylaşın. Rapor yalnız bağlı ölçümlerden ve kayıtlardan oluşur.', 'When a month ends, the “Monthly report” under Analytics is prepared; read and approve it, and share it with an expiring link if you like. It is made only from connected measurements and records.'),
    rows("SELECT COUNT(*) n FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND state='approved' AND approved_at>=?", new Date(now - 45 * DAY).toISOString()) > 0, 'analytics') : null;

  // 7. Weekly results: measurement sources, the weekly KPI report and acting on it.
  {
    const ga4 = Boolean(env.GA4_PROPERTY_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON), report = content.kpi, acted = lastActivity('kpi_action');
    jobs.push({ id: 'crewin_results', title: l('Haftalık sonuçları değerlendir', 'Review this week’s results'), outcome: l('Kayıt, profil doluluğu, ilan ve trafik rakamlarının haftalık raporla önceki haftayla karşılaştırılması ve bir sonraki işin seçilmesi.', 'Sign-ups, profile completion, job ads and traffic compared week over week in a report, and the next job chosen.'),
      keywords: ['rapor', 'report', 'kpi', 'sonuç', 'result', 'analitik', 'analytics', 'ga4', 'google analytics', 'trafik', 'traffic', 'haftalık', 'weekly', 'ölçüm', 'measure', 'search console'],
      badge: null,
      steps: [
        step('ga4', l('Google Analytics bağlı olsun', 'Have Google Analytics connected'), l('Analitik sekmesi site ziyaretlerini GA4’ten okur; bağlı değilse orada “yapılandırılmamış” uyarısı görünür.', 'The Analytics tab reads site visits from GA4; if it is not connected, it shows a “not configured” notice.'), ga4, 'analytics', ga4 ? null : SERVER('GA4_PROPERTY_ID ve GOOGLE_SERVICE_ACCOUNT_JSON', 'GA4_PROPERTY_ID and GOOGLE_SERVICE_ACCOUNT_JSON'), null),
        step('report', l('Bu haftanın KPI raporunu çıkarın', 'Generate this week’s KPI report'), l('KPI & raporlar’da “Haftalık KPI Raporu Üret”e basın; rapor canlı Crewin verisiyle hazırlanır ve geçmişe kaydedilir. Geçmiş → “Karşılaştırmak için seç” ile önceki haftayla kıyaslayın.', 'In KPI & reports, press “Generate weekly KPI report”; it uses live Crewin data and is saved to history. Compare with last week via History → “Select to compare”.'), now - report < WEEK, 'kpi', null, last(l('Son rapor', 'Last report'), report, now)),
        step('act', l('Rapordaki bir öneriyi uygulayın', 'Act on one suggestion in the report'), l('Raporun altındaki eylem kartlarından birini seçin (ör. “Re-engagement — Profil Açmayanlar”); taslağı hazırlar, gönderme kararı yine sizdedir.', 'Pick one of the action cards under the report (e.g. “Re-engagement — profiles not opened”); it prepares a draft, sending is still your decision.'), now - acted < WEEK && acted >= report - DAY, 'kpi', null, last(l('Son eylem', 'Last action'), acted, now)),
        ...(monthly ? [monthly] : []),
      ] });
  }

  // 9–12. Ryzevo features in the Crewin workspace, read from the platform tables.
  if (db) {
    const grounded = Boolean(env.PLATFORM_GEMINI_API_KEY && /gemini-(?:2|[3-9])/.test(env.PLATFORM_GEMINI_MODEL || ''));
    const google = Boolean(env.PLATFORM_GOOGLE_CLIENT_ID && env.PLATFORM_GOOGLE_CLIENT_SECRET && env.PLATFORM_GOOGLE_REDIRECT_URI);
    const meta = Boolean(env.PLATFORM_META_APP_ID && env.PLATFORM_META_APP_SECRET && env.PLATFORM_META_REDIRECT_URI && env.PLATFORM_META_GRAPH_VERSION);
    const coach = (() => { try { return db.prepare('SELECT draft_json,brief_json FROM platform_growth_coach WHERE organization_id=? AND project_id=?').get(...CREWIN) as { draft_json: string | null; brief_json: string | null } | undefined; } catch { return undefined; } })();
    const review = rows('SELECT COUNT(*) n FROM platform_coach_reviews WHERE organization_id=? AND project_id=? AND updated_at>=?', new Date(now - WEEK).toISOString());
    jobs.push({ id: 'crewin_growth', title: l('Büyüme stratejisi çıkar ve haftalık uygula', 'Build a growth strategy and follow it weekly'), outcome: l('Crewin için onaylı bir strateji briefi (ideal kullanıcı, öncelikli kanallar, 30 günlük plan) ve her hafta işlenen eylem listesi.', 'An approved strategy brief for Crewin (ideal user, priority channels, a 30-day plan) and an action list worked through every week.'),
      keywords: ['strateji', 'strategy', 'koç', 'coach', 'plan', 'teşhis', 'diagnosis', 'brief', 'hedef', 'goal', 'büyüme', 'growth', 'haftalık', 'weekly'],
      badge: coach?.draft_json && !coach.brief_json ? { count: 1, label: l('strateji taslağı onay bekliyor', 'strategy draft awaiting approval') } : null,
      steps: [
        step('diagnose', l('Büyüme teşhisini yapın', 'Run the growth diagnosis'), l('Genel bakış → Büyüme koçu → “Teşhise başla”: ana hedefi seçip 11 kısa soruyu yanıtlayın. Ryzevo yanıtlardan bir strateji taslağı hazırlar.', 'Overview → Growth coach → “Start the diagnosis”: pick the main goal and answer 11 short questions. Ryzevo drafts a strategy from the answers.'), Boolean(coach?.draft_json || coach?.brief_json), 'dashboard'),
        step('approve', l('Strateji briefini onaylayın', 'Approve the strategy brief'), l('Büyüme koçu → “Taslağı incele”: istediğiniz satırı düzeltin ve “Briefi onayla”ya basın. Onaydan sonra haftanın eylemleri koç kartında listelenir.', 'Growth coach → “Review the draft”: edit any line and press “Approve the brief”. After approval, the week’s actions are listed on the coach card.'), Boolean(coach?.brief_json), 'dashboard'),
        step('review', l('Bu haftanın özetini çıkarın', 'Prepare this week’s review'), l('Genel bakış → Haftalık değerlendirme → “Bu haftanın özetini hazırla”: özet yalnız Crewin kayıtlarından (taslaklar, paylaşımlar, ölçümler) çıkar; plan değişikliği önerisi onayla uygulanır.', 'Overview → Weekly review → “Prepare this week’s review”: it is built only from Crewin’s records (drafts, posts, measurements); a plan change is applied only with approval.'), review > 0, 'dashboard'),
      ] });

    const scanned = rows("SELECT COUNT(*) n FROM platform_seo_scans WHERE organization_id=? AND project_id=? AND state='completed'") > 0;
    const finding = (...titles: string[]) => rows(`SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open' AND title IN (${titles.map(() => '?').join(',')})`, ...titles);
    jobs.push({ id: 'crewin_ai', title: l('ChatGPT ve Gemini’de görün', 'Appear in ChatGPT and Gemini'), outcome: l('Gemi adamları veya firmalar AI asistanlarına sorduğunda Crewin’in anılması ve crewinjob.com’un kaynak gösterilmesi.', 'Crewin named and crewinjob.com cited when seafarers or companies ask AI assistants.'),
      keywords: ['ai', 'yapay zeka', 'chatgpt', 'gemini', 'perplexity', 'claude', 'geo', 'llms', 'asistan', 'assistant', 'görünürlük', 'visibility'],
      badge: null,
      steps: [
        step('scan', l('Otomatik taramayı bir kez çalıştırın', 'Run the automatic scan once'), l('SEO & Blog → “Otomatik tarama”da taramayı başlatın; AI tarayıcılarının siteyi okuyup okuyamadığı da kontrol edilir.', 'In SEO & Blog → “Automatic scan”, start the scan; it also checks whether AI crawlers can read the site.'), scanned, 'seo&view=ops'),
        step('access', l('AI tarayıcılarının önündeki engeli kaldırın', 'Remove what blocks AI crawlers'), l('robots.txt AI arama botlarını engelliyorsa veya sayfa JavaScript olmadan boş görünüyorsa, bulgudaki geliştirici metnini kopyalayıp geliştiriciye verin. Ryzevo siteyi değiştirmez.', 'If robots.txt blocks AI search bots or the page is empty without JavaScript, copy the finding’s developer text to your developer. Ryzevo does not change the site.'), scanned && finding('AI arama botları engelli', 'Sayfa içeriği JavaScript olmadan okunamıyor') === 0, 'seo&view=ops'),
        step('llms', l('llms.txt dosyasını yayınlayın', 'Publish llms.txt'), l('“Otomatik tarama” ekranındaki llms.txt taslağını düzenleyip crewinjob.com’un köküne koydurun.', 'Edit the llms.txt draft on the “Automatic scan” screen and have it placed at crewinjob.com’s root.'), scanned && finding('llms.txt bulunamadı') === 0, 'seo&view=ops'),
        step('questions', l('Kullanıcılarınızın sorularını yazın', 'Write your users’ questions'), l('SEO & Blog → “AI görünürlüğü”nde markayı bilmeden sorulacak birkaç soru ekleyin (ör. “Gemi adamları için en iyi iş ilanı sitesi hangisi?”).', 'In SEO & Blog → “AI visibility”, add a few questions asked without knowing the brand (e.g. “Which is the best job site for seafarers?”).'), rows('SELECT COUNT(*) n FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=?') > 0, 'seo&view=visibility'),
        withSetup(step('ask', l('Soruları sorun ve sonucu görün', 'Ask and see the result'), l('Cevapta Crewin anıldı mı, crewinjob.com kaynak gösterildi mi, hangi rakipler geçti; haftalık takip de açılabilir.', 'Was Crewin named, was crewinjob.com cited, which competitors came up; weekly tracking can be turned on too.'), rows("SELECT COUNT(*) n FROM platform_ai_visibility_checks WHERE organization_id=? AND project_id=? AND status='ok'") > 0, 'seo&view=visibility',
          grounded ? null : SERVER('Google aramalı AI modeli (PLATFORM_GEMINI_API_KEY ve gemini-2 veya üstü PLATFORM_GEMINI_MODEL)', 'the search-grounded AI model (PLATFORM_GEMINI_API_KEY and a gemini-2 or later PLATFORM_GEMINI_MODEL)')), 'gemini'),
      ] });

    const open = rows("SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open'");
    const workerLast = (() => { try { return Date.parse((db.prepare("SELECT last_success_at FROM platform_worker_observations WHERE component='platform-worker'").get() as { last_success_at: string | null } | undefined)?.last_success_at || '') || 0; } catch { return 0; } })(), workerFresh = now - workerLast < 30 * 60_000;
    jobs.push({ id: 'crewin_search', title: l('Google’da otomatik takip', 'Automatic tracking on Google'), outcome: l('crewinjob.com’un düzenli taranması, yeni sorunların ve Search Console’daki düşüşlerin kendiliğinden haber verilmesi.', 'crewinjob.com scanned regularly, with new issues and Search Console drops reported on their own.'),
      keywords: ['google', 'search console', 'gsc', 'otomatik', 'automatic', 'tarama', 'scan', 'takvim', 'schedule', 'düşüş', 'drop', 'seo', 'uyarı', 'alert'],
      badge: open ? { count: open, label: l('açık SEO bulgusu', 'open SEO finding(s)') } : null,
      steps: [
        withSetup(step('connect', l('Search Console’u Ryzevo’ya bağlayın', 'Connect Search Console to Ryzevo'), l('Proje ayarları → Bağlantılar → “Google hesabı bağla”da Search Console’u seçip crewinjob.com mülkünü yazın; Google’ın kendi ekranında izin verirsiniz.', 'In Project settings → Connections → “Connect Google account”, choose Search Console and enter the crewinjob.com property; you approve on Google’s own screen.'), rows("SELECT COUNT(*) n FROM platform_connections WHERE organization_id=? AND project_id=? AND active=1 AND provider='search_console'") > 0, 'project&settings=connections',
          google ? null : SERVER('Google OAuth (PLATFORM_GOOGLE_CLIENT_ID, PLATFORM_GOOGLE_CLIENT_SECRET, PLATFORM_GOOGLE_REDIRECT_URI)', 'Google OAuth (PLATFORM_GOOGLE_CLIENT_ID, PLATFORM_GOOGLE_CLIENT_SECRET, PLATFORM_GOOGLE_REDIRECT_URI)')), 'google'),
        step('schedule', l('Otomatik taramayı açın', 'Turn on the automatic scan'), l('SEO & Blog → “Otomatik tarama”da haftalık veya aylık taramayı açın; yeni bulgu ve arama düşüşü Genel bakış → Dikkat gerekenler’de ve tarayıcı bildiriminde görünür.', 'In SEO & Blog → “Automatic scan”, turn on a weekly or monthly scan; new findings and search drops appear in Overview → Needs attention and as browser notifications.'), rows('SELECT COUNT(*) n FROM platform_seo_schedules WHERE organization_id=? AND project_id=?') > 0, 'seo&view=ops'),
        step('worker', l('Zamanlanmış işlerin çalıştığını doğrulayın', 'Check that scheduled jobs run'), l('Otomatik tarama, düşüş uyarısı ve haftalık AI kontrolü ancak zamanlanmış işler (worker) birkaç dakikada bir çalışınca yürür. Kurulum rehberindeki “Zamanlanmış işler” kartı bu sunucu için hazır komutu verir.', 'Automatic scans, drop alerts and the weekly AI check only run when scheduled jobs (the worker) run every few minutes. The “Scheduled jobs” card in the setup guide gives the ready command for this server.'), workerFresh, 'project&settings=operations&setup=worker', null,
          workerLast ? last(l('Son çalışma', 'Last run'), workerLast, now) : l('Henüz hiç çalışmadı', 'It has not run yet')),
        step('findings', l('Açık bulguları ele alın', 'Handle the open findings'), l('Her bulgunun geliştirici metnini kopyalayın veya “İş planına ekle” ile Takvim → İş ve içerik planı’na koyun; düzeldiğinde sonraki tarama işaretler.', 'Copy each finding’s developer text or put it in Calendar → Work and content plan with “Add to work plan”; the next scan marks it fixed.'), scanned && open === 0, 'seo&view=ops', null,
          open ? l(`${number(open).tr} açık bulgu`, `${number(open).en} open finding(s)`) : null),
      ] });

    const unread = rows("SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND state='new'");
    jobs.push({ id: 'crewin_inbox', title: l('Yorum ve mesajlara cevap ver', 'Answer comments and messages'), outcome: l('Crewin’in Facebook Sayfası ve Instagram hesabındaki yorum ve mesajları tek yerden okuyup onaylı cevap göndermek.', 'Reading comments and messages on Crewin’s Facebook Page and Instagram account in one place and sending approved replies.'),
      keywords: ['mesaj', 'message', 'yorum', 'comment', 'dm', 'cevap', 'reply', 'gelen kutusu', 'inbox', 'facebook', 'instagram', 'meta'],
      badge: unread ? { count: unread, label: l('yeni mesaj/yorum', 'new message(s)/comment(s)') } : null,
      steps: [
        withSetup(step('connect', l('Meta hesabını Ryzevo’ya bağlayın', 'Connect the Meta account to Ryzevo'), l('Proje ayarları → Bağlantılar’da Meta ile bağlanıp Crewin Sayfasını ve Instagram hesabını seçin. Crewin’in paylaşımları yine Sosyal medya sekmesinden yapılır.', 'In Project settings → Connections, connect with Meta and choose the Crewin Page and Instagram account. Crewin’s posts are still made from the Social media tab.'), rows('SELECT COUNT(*) n FROM platform_social_inbox_accounts WHERE organization_id=? AND project_id=?') > 0, 'project&settings=connections',
          meta ? null : SERVER('Meta uygulaması (PLATFORM_META_APP_ID, PLATFORM_META_APP_SECRET, PLATFORM_META_REDIRECT_URI, PLATFORM_META_GRAPH_VERSION)', 'the Meta app (PLATFORM_META_APP_ID, PLATFORM_META_APP_SECRET, PLATFORM_META_REDIRECT_URI, PLATFORM_META_GRAPH_VERSION)')), 'meta'),
        step('read', l('Gelen kutusunu okuyun', 'Read the inbox'), l('Kampanyalar → “Gelen kutusu”nda okumayı açın; okuma 30 dakikada bir kendiliğinden de yapılır.', 'In Campaigns → “Inbox”, turn on reading; it also runs on its own every 30 minutes.'), rows('SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=?') > 0, 'campaigns&view=inbox'),
        step('reply', l('Cevabı onaylayıp gönderin', 'Approve and send a reply'), l('Cevabı yazın veya AI önerisini düzenleyin; cevap ancak onaydan sonra gider. Mesajlarda 24 saatlik pencere kuralı vardır.', 'Write the reply or edit the AI suggestion; it goes only after approval. Messages have a 24-hour window.'), rows("SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND reply_state='sent'") > 0, 'campaigns&view=inbox'),
      ] });
  }

  // 8. Bank-transfer orders waiting: companies paid and wait for their credits.
  if (orders.ok) {
    const pending = total(orders.value);
    jobs.push({ id: 'crewin_credits', title: l('Bekleyen havale siparişlerini onayla', 'Approve pending bank-transfer orders'), outcome: l('Havaleyle ödeme yapan firmaların kredisinin, dekont kontrol edildikten sonra tanımlanması.', 'Credits of companies that paid by bank transfer granted after their receipt is checked.'),
      keywords: ['kredi', 'credit', 'ödeme', 'payment', 'havale', 'transfer', 'sipariş', 'order', 'dekont', 'receipt', 'firma', 'fatura', 'onay'],
      badge: pending ? { count: pending, label: l('sipariş onay bekliyor', 'order(s) awaiting approval') } : null,
      steps: [
        step('orders', l('Bekleyen siparişleri kontrol edin', 'Check the pending orders'), l('Kredi & ödeme → Bekleyen siparişler’de her siparişin dekontunu ve tutarını banka hesabıyla karşılaştırın; tutuyorsa “Onayla”, tutmuyorsa “İptal et”. Onay krediyi hemen tanımlar ve geri almak için hareket iptali gerekir.', 'In Credits & payments → Pending orders, compare each order’s receipt and amount with the bank account; “Approve” if they match, otherwise “Cancel”. Approval grants the credits at once; undoing it needs a movement cancellation.'), pending === 0, 'firma_kredi&view=bekleyen', null,
          pending ? l(`${number(pending).tr} sipariş bekliyor`, `${number(pending).en} order(s) waiting`) : l('Bekleyen sipariş yok', 'No pending orders')),
      ] });
  } else unavailable.push(l('Havale siparişleri: kredi servisi şu an yanıt vermiyor veya bu hesapta yetki yok.', 'Bank-transfer orders: the credit service is not answering or this account lacks the permission.'));

  // Money and waiting work first, then jobs under way, then the base order of Crewin’s goals; finished jobs last.
  const BASE: JobId[] = ['crewin_credits', 'crewin_jobs', 'crewin_profiles', 'crewin_social', 'crewin_leads', 'crewin_growth', 'crewin_results', 'crewin_seo', 'crewin_search', 'crewin_ai', 'crewin_inbox', 'crewin_campaign'];
  const items: JobGuideItem[] = jobs.map(job => {
    const done = job.steps.filter(item => item.state === 'done').length, next = job.steps.find(item => item.state !== 'done');
    const actionable = job.steps.some(item => item.state !== 'done' && item.canAct);
    const relevance = (done === job.steps.length ? -100 : 0) + (job.id === 'crewin_credits' && job.badge ? 40 : 0) + (job.badge ? 30 : 0) + (done > 0 && done < job.steps.length ? 20 : 0) + (actionable ? 10 : -40) + (BASE.length - BASE.indexOf(job.id));
    return { ...job, done, total: job.steps.length, nextStepId: next?.id || null, complete: !next, relevance };
  }).sort((a, b) => b.relevance - a.relevance);
  return { jobs: items, intent: null, ...(unavailable.length ? { unavailable } : {}) };
}
