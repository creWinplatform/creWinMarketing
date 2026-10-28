import 'server-only';
import fs from 'fs';
import path from 'path';
import type { LocalizedText } from './catalog';
import type { JobGuideItem, JobGuideView, JobId, JobStep } from './job-guide-types';

// "What would you like to do?" for the Crewin workspace. Its legacy tabs keep their records in JSON files (web data/,
// agent data/) and in the Crewin backend, not in the platform tables, so the steps are read from there. A step is done
// only when a record shows it; weekly work (posting, reporting) counts from the last 7 days, so it comes back each week.
// Legacy tabs open on their first view; each step names the exact sub-tab and button to press.

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
};
export type CrewinStats = { seafarers?: { newThisWeek?: number; fillRateBuckets?: { zero?: number; low?: number } }; jobs?: { newThisWeek?: number | null } };

// Parsed summaries are kept until the file changes (content-history.json is ~20 MB of base64 images, the review queue
// several MB), so a guide refresh on every tab focus costs a stat() per file.
type Entry = { key: string; value: unknown };
const g = globalThis as typeof globalThis & { __crewinGuideFiles?: Map<string, Entry>; __crewinGuideRemote?: Map<string, { at: number; ok: boolean; value: unknown; pending?: Promise<unknown> }> };
const files = g.__crewinGuideFiles ?? (g.__crewinGuideFiles = new Map());
const remote = g.__crewinGuideRemote ?? (g.__crewinGuideRemote = new Map());
function summary<T>(file: string, empty: T, reduce: (data: unknown) => T): T {
  let stat: fs.Stats; try { stat = fs.statSync(file); } catch { return empty; }
  const key = `${stat.mtimeMs}:${stat.size}`, hit = files.get(file);
  if (hit?.key === key) return hit.value as T;
  let value = empty; try { const raw = fs.readFileSync(file, 'utf8'); value = raw.trim() ? reduce(JSON.parse(raw)) : empty; } catch { value = empty; }
  files.set(file, { key, value }); return value;
}
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
export function resetCrewinGuideCache() { files.clear(); remote.clear(); }

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
        step('review', l('Botun bulduğu yeni ilanları inceleyin', 'Review the job ads the bot found'), l('Otomasyon → 🔍 İnceleme Kuyruğu’nda her ilanı okuyun: ✅ Onayla ilanı crewinjob.com’da yayınlar, ❌ Reddet kuyruktan çıkarır. Son 7 günde bulunan ilan kalmayınca tamamlanır.', 'In Automation → 🔍 Review queue, read each ad: ✅ Approve publishes it on crewinjob.com, ❌ Reject removes it. Done when no ad found in the last 7 days is left.'), fresh === 0, 'pipeline', null,
          join(fresh ? l(`Son 7 günde bulunan ${number(fresh).tr} ilan bekliyor`, `${number(fresh).en} ad(s) found in the last 7 days waiting`) : null, stale ? l(`${number(stale).tr} eski kayıt da kuyrukta; artık gerekmiyorsa aynı ekranda “Tümünü Temizle” ile boşaltılabilir`, `${number(stale).en} older item(s) are queued too; if no longer needed, “Clear all” on the same screen empties them`) : null)),
        step('publish', l('Bu hafta ilan yayınlayın', 'Publish a job ad this week'), l('İlan botu → ✏️ İlan Oluştur’da ilan metnini yapıştırıp alanları kontrol edin ve 🚀 Hemen Yayınla’ya basın; ya da 📥 Kuyruğa Ekle ile sıraya alıp 📥 Kuyruk’ta 🚀 Onayla & Yayınla deyin. İlan crewinjob.com’da hemen görünür.', 'In Job bot → ✏️ Create, paste the ad text, check the fields and press 🚀 Publish now; or queue it with 📥 Add to queue and press 🚀 Approve & publish in 📥 Queue. The ad appears on crewinjob.com at once.'), jobPosts.length > 0, 'jobbot', null,
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
        step('send', l('Hatırlatmayı gönderin', 'Send the reminder'), l('WA & Telegram → Mevcut Kullanıcı (Gönder) → “E-posta Re-aktivasyon”da 📥 Segmentten Yükle ile alıcıları getirin, metni kontrol edip “📧 Kampanyayı Gönder”e basın (WhatsApp için “WA Bildirim Gönder”). Gönderim geri alınamaz; abonelikten çıkanlara gitmez.', 'In WA & Telegram → Existing users (Send) → “Email re-activation”, load recipients with 📥 Load from segment, check the text and press “📧 Send campaign” (for WhatsApp, “Send WA notification”). Sending cannot be undone; unsubscribed people are skipped.'), now - sent < MONTH, 'messaging',
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
        step('draft', l('Kayıt çağrılı gönderiyi hazırlayın', 'Prepare a post with a sign-up call'), l('Gemi adamı büyümesi → 🎯 Kayıt içeriği (veya 🎵 TikTok scripti) → “İçerik üret”; ya da Sosyal medya’da konu yazıp “İçerik Üret”. Taslak İçerik kütüphanesine kaydedilir.', 'In Seafarer growth → 🎯 Sign-up content (or 🎵 TikTok script) → “Generate”; or write a topic in Social media and press “Generate”. The draft is saved in the content library.'), now - content.social < WEEK, 'growth', null, last(l('Son taslak', 'Last draft'), content.social, now)),
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
        step('research', l('Lead bulun', 'Find leads'), l('Kampanyalar → AI Prospect Finder → “AI ile araştır”da ülke ve şirket tipini seçip “AI araştırmasını başlat”a basın; tanıdığınız firmaları “Görüşme / lead ekle” ile ekleyin.', 'In Campaigns → AI Prospect Finder → “Research with AI”, choose country and company type and press “Start AI research”; add companies you know via “Add meeting / lead”.'), rows.length > 0, 'campaigns', null,
          rows.length ? l(`Havuzda ${number(rows.length).tr} lead`, `${number(rows.length).en} lead(s) in the pool`) : null),
        step('review', l('İncelemedeki lead’lere karar verin', 'Decide on the leads in review'), l('Lead havuzu’nda durumu “İncelenecek” olan her lead için “Onaylandı” ya da “Reddedildi”yi seçin. Alan adının e-posta sunucusu (MX) yoksa veya adres geçersizse onaylanamaz; info@/hr@ gibi rol adreslerine izin kontrolü yapın.', 'In Lead pool, set each lead whose status is “Review” to “Approved” or “Rejected”. A lead whose domain has no mail server (MX) or whose address is invalid cannot be approved; check consent for role addresses such as info@ or hr@.'), inReview === 0 && rows.length > 0, 'campaigns', null,
          rows.length ? l(`${number(approved).tr} onaylı, ${number(inReview).tr} incelemede`, `${number(approved).en} approved, ${number(inReview).en} in review`) : null),
        step('campaign', l('Onaylı lead’lere ulaşın', 'Reach the approved leads'), l('Lead havuzu’nda “Onaylı lead’leri kampanyaya aktar” ile Kampanya akışlarında taslak açın, metni yazıp “Kampanyayı hazırla”; göndermek ayrı bir adımdır (“Şimdi başlat”).', 'In Lead pool, use “Move approved leads to a campaign” to open a draft in Campaign flows, write it and press “Prepare campaign”; sending is a separate step (“Start now”).'), prospectCampaign || reached > 0, 'campaigns',
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
        step('draft', l('Kampanyayı hazırlayın', 'Prepare the campaign'), l('Kampanyalar → Kampanya akışları → “Yeni kampanya”: hedef, kitle (doluluk, ülke, pozisyon) ve kanalları seçin, “Kitleyi hesapla” ile kaç kişiye gideceğini görün, metni yazıp “Kampanyayı hazırla”ya basın. Hazırlamak göndermek değildir.', 'In Campaigns → Campaign flows → “New campaign”: choose the goal, audience (completion, country, position) and channels, see the size with “Calculate audience”, write the text and press “Prepare campaign”. Preparing is not sending.'), rows.length > 0, 'campaigns', null,
          rows.length ? l(`${number(rows.length).tr} kampanya kayıtlı`, `${number(rows.length).en} campaign(s) saved`) : null),
        step('start', l('Kontrol edip başlatın', 'Check and start it'), l('Kampanya kartında içerik ve kitleyi son kez kontrol edin; “Şimdi başlat” gönderimi başlatır ve geri alınamaz. İleri bir tarih için “Zamanla”yı kullanın; başarısız teslimatları “Başarısızları yeniden dene” ile tekrar deneyin.', 'Check content and audience one last time on the campaign card; “Start now” begins sending and cannot be undone. Use “Schedule” for a later date; retry failed deliveries with “Retry failed”.'), started > 0, 'campaigns', null,
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
        step('audit', l('Siteyi denetleyin', 'Audit the site'), l('SEO & Blog → Site Denetimi’nde “Site taramasını başlat”a basın; bulunan sorunları “Öneriye ekle” ile iş listesine alın.', 'In SEO & Blog → Site audit, press “Start site crawl”; add the issues found to the work list with “Add as suggestion”.'), crawled > 0, 'seo', null, null),
        step('decide', l('Önerilere karar verin', 'Decide on the suggestions'), l('Site Denetimi’ndeki iş listesinde her öneriyi “Onayla” veya “Reddet”; onaylananı geliştiriciye verip uygulanınca “Manuel uygulamayı kaydet”e basın. Panel sitenizi kendisi değiştirmez.', 'In the Site audit work list, “Approve” or “Reject” each suggestion; give approved ones to the developer and press “Record manual fix” once applied. The panel never changes your site itself.'), seoItems.any > 0 && seoItems.proposed === 0 && seoItems.approved === 0, 'seo', null,
          seoItems.any ? l(`${number(seoItems.proposed).tr} karar bekliyor, ${number(seoItems.approved).tr} onaylı uygulanmayı bekliyor, ${number(seoItems.applied).tr} uygulandı`, `${number(seoItems.proposed).en} awaiting a decision, ${number(seoItems.approved).en} approved awaiting the fix, ${number(seoItems.applied).en} applied`) : null),
        step('blog', l('Bu ay blog yazısı yayınlayın', 'Publish a blog post this month'), l('SEO & Blog → Blog Makalesi’nde konuyu yazıp “Makale Üret”, metni okuyup düzeltin ve “🚀 Blogu Yayınla”ya basın; yazı görseliyle crewinjob.com/blog’da yayınlanır.', 'In SEO & Blog → Blog article, enter the topic and press “Generate article”, read and edit it, then press “🚀 Publish blog”; it goes live with its image on crewinjob.com/blog.'), now - blogPublished < MONTH, 'seo', null,
          join(last(l('Son yayın', 'Last published'), blogPublished, now), !blogPublished ? last(l('Son blog taslağı', 'Last blog draft'), content.blog, now) : null)),
      ] });
  }

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
      ] });
  }

  // 8. Bank-transfer orders waiting: companies paid and wait for their credits.
  if (orders.ok) {
    const pending = total(orders.value);
    jobs.push({ id: 'crewin_credits', title: l('Bekleyen havale siparişlerini onayla', 'Approve pending bank-transfer orders'), outcome: l('Havaleyle ödeme yapan firmaların kredisinin, dekont kontrol edildikten sonra tanımlanması.', 'Credits of companies that paid by bank transfer granted after their receipt is checked.'),
      keywords: ['kredi', 'credit', 'ödeme', 'payment', 'havale', 'transfer', 'sipariş', 'order', 'dekont', 'receipt', 'firma', 'fatura', 'onay'],
      badge: pending ? { count: pending, label: l('sipariş onay bekliyor', 'order(s) awaiting approval') } : null,
      steps: [
        step('orders', l('Bekleyen siparişleri kontrol edin', 'Check the pending orders'), l('Kredi & ödeme → Bekleyen siparişler’de her siparişin dekontunu ve tutarını banka hesabıyla karşılaştırın; tutuyorsa “Onayla”, tutmuyorsa “İptal et”. Onay krediyi hemen tanımlar ve geri almak için hareket iptali gerekir.', 'In Credits & payments → Pending orders, compare each order’s receipt and amount with the bank account; “Approve” if they match, otherwise “Cancel”. Approval grants the credits at once; undoing it needs a movement cancellation.'), pending === 0, 'firma_kredi', null,
          pending ? l(`${number(pending).tr} sipariş bekliyor`, `${number(pending).en} order(s) waiting`) : l('Bekleyen sipariş yok', 'No pending orders')),
      ] });
  } else unavailable.push(l('Havale siparişleri: kredi servisi şu an yanıt vermiyor veya bu hesapta yetki yok.', 'Bank-transfer orders: the credit service is not answering or this account lacks the permission.'));

  // Money and waiting work first, then jobs under way, then the base order of Crewin’s goals; finished jobs last.
  const BASE: JobId[] = ['crewin_credits', 'crewin_jobs', 'crewin_profiles', 'crewin_social', 'crewin_leads', 'crewin_results', 'crewin_seo', 'crewin_campaign'];
  const items: JobGuideItem[] = jobs.map(job => {
    const done = job.steps.filter(item => item.state === 'done').length, next = job.steps.find(item => item.state !== 'done');
    const actionable = job.steps.some(item => item.state !== 'done' && item.canAct);
    const relevance = (done === job.steps.length ? -100 : 0) + (job.id === 'crewin_credits' && job.badge ? 40 : 0) + (job.badge ? 30 : 0) + (done > 0 && done < job.steps.length ? 20 : 0) + (actionable ? 10 : -40) + (BASE.length - BASE.indexOf(job.id));
    return { ...job, done, total: job.steps.length, nextStepId: next?.id || null, complete: !next, relevance };
  }).sort((a, b) => b.relevance - a.relevance);
  return { jobs: items, intent: null, ...(unavailable.length ? { unavailable } : {}) };
}
