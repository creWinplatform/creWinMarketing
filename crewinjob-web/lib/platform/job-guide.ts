import 'server-only';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import type { WorkspacePermission } from './access';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { hasMessagingDuty } from './messaging-duties';
import { emailSenderReadiness } from './email-sender';
import { socialPublishingEnabled } from './linkedin-publishing';
import type { JobGuideItem, JobGuideView, JobId, JobStep } from './job-guide-types';

const l = (tr: string, en: string): LocalizedText => ({ tr, en });
const SOCIAL = "('linkedin','facebook','instagram','twitter','telegram')";
// Who does a step this member cannot do. Named by role, never by person.
const WHO: Record<string, LocalizedText> = {
  'connections.manage': l('Bu adımı proje sahibi veya yöneticisi yapar (hesap bağlama yetkisi).', 'The project owner or an admin does this step (connection rights).'),
  'members.manage': l('Bu adımı proje sahibi veya yöneticisi yapar.', 'The project owner or an admin does this step.'),
  'content.write': l('Bu adımı içerik yazma yetkisi olan bir ekip üyesi yapar.', 'A teammate with content rights does this step.'),
  'campaign.approve': l('Bu adımı onay yetkisi olan bir ekip üyesi yapar.', 'A teammate with approval rights does this step.'),
  'campaign.dispatch': l('Bu adımı yayın/gönderim yetkisi olan bir ekip üyesi yapar.', 'A teammate with publishing rights does this step.'),
  duty: l('Bu adım için mesajlaşma görevi gerekir; proje sahibi verir.', 'This step needs a messaging duty; the project owner gives it.'),
};

// Steps of each job, computed from the project's records for one member.
export function jobGuide(db: Database.Database, scope: MarketingScope): JobGuideView {
  const repo = new PlatformRepository(db), args = [scope.organizationId, scope.projectId] as const;
  const workspace = repo.workspace(scope.subject, ...args);
  if (!workspace || workspace.project.productPack !== 'standard') throw new MarketingStoreError('İş rehberi için standart proje erişimi gerekli.', 403);
  const project = workspace.project, can = (permission: WorkspacePermission) => repo.can(scope.subject, ...args, permission);
  const tab = (href: string) => new URL(href, 'https://ryzevo.invalid').searchParams.get('tab'), enabled = (href: string) => workspace.modules.some(module => module.id === tab(href));
  const one = <T,>(sql: string, ...values: unknown[]) => db.prepare(sql).get(...args, ...values) as T;
  const count = (sql: string, ...values: unknown[]) => (one<{ n: number }>(sql, ...values)?.n) || 0;
  const step = (id: string, label: LocalizedText, detail: LocalizedText, done: boolean, href: string, permission: WorkspacePermission | 'duty:source.read' | 'duty:publish', operator: LocalizedText | null = null): JobStep => {
    const allowed = permission.startsWith('duty:') ? hasMessagingDuty(db, scope.subject, ...args, permission.slice(5) as 'source.read' | 'publish') : can(permission as WorkspacePermission);
    const reason = done ? null : !enabled(href) ? l('Bu araç projenizde açık değil; proje yöneticisine danışın.', 'This tool is not enabled in your project; ask the project administrator.') : operator || (allowed ? null : WHO[permission.startsWith('duty:') ? 'duty' : permission]);
    return { id, label, detail, state: done ? 'done' : reason ? 'blocked' : 'todo', href, canAct: allowed && enabled(href) && !operator, reason };
  };
  const jobs: Omit<JobGuideItem, 'done' | 'total' | 'nextStepId' | 'complete' | 'relevance'>[] = [];
  const add = (id: JobId, title: LocalizedText, outcome: LocalizedText, keywords: string[], build: () => { steps: JobStep[]; badge?: JobGuideItem['badge'] }) => {
    try { const { steps, badge = null } = build(); jobs.push({ id, title, outcome, keywords, steps, badge }); } catch { /* a job whose records cannot be read is left out, never shown half-checked */ }
  };
  const connections = (providers: string[]) => count(`SELECT COUNT(*) n FROM platform_connections WHERE organization_id=? AND project_id=? AND active=1 AND provider IN (${providers.map(() => '?').join(',')})`, ...providers);
  const draft = () => count(`SELECT COUNT(*) n FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.platform') IN ${SOCIAL} AND COALESCE(json_extract(payload,'$.starter'),0)=0`) > 0
    || count(`SELECT COUNT(*) n FROM platform_campaigns c,json_each(c.payload,'$.channels.social') ch WHERE c.organization_id=? AND c.project_id=? AND ch.value IN ${SOCIAL}`) > 0;
  const scanned = () => count("SELECT COUNT(*) n FROM platform_seo_scans WHERE organization_id=? AND project_id=? AND state='completed'") > 0;
  const openFinding = (...titles: string[]) => count(`SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open' AND title IN (${titles.map(() => '?').join(',')})`, ...titles);
  const operator = (on: boolean, text: LocalizedText) => on ? null : text;
  const RYZEVO = (what: string, whatEn: string) => l(`${what} bu sunucuda kapalı; Ryzevo yöneticisi açar. Önceki adımları şimdiden yapabilirsiniz.`, `${whatEn} is off on this server; the Ryzevo operator turns it on. You can do the earlier steps now.`);

  add('social_post', l('Sosyal medyada paylaşım yap', 'Publish on social media'), l('Bir gönderinin Instagram, Facebook, LinkedIn, X veya Telegram’da gerçekten yayınlanması.', 'A post actually published on Instagram, Facebook, LinkedIn, X or Telegram.'),
    ['instagram', 'facebook', 'linkedin', 'x', 'twitter', 'telegram', 'paylaşım', 'paylas', 'gönderi', 'post', 'yayın', 'publish', 'sosyal', 'social', 'reels', 'story', 'hikaye'], () => {
      const ready = count("SELECT COUNT(*) n FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id JOIN platform_social_publish_checks k ON k.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND k.expires_at>?", new Date().toISOString()) > 0 || connections(['x']) > 0;
      // A connected account whose publishing access has not been tested needs a different step than no account at all.
      const linked = connections(['social']) > 0;
      return { steps: [
        !ready && linked
          ? step('connect', l('Bağlı hesabın yayın iznini test edin', 'Test the connected account’s publishing access'), l('Hesap bağlı ama yayın izni henüz doğrulanmadı. Takvim → Sosyal yayınlar’da hesabı seçip “Yayın iznini kontrol et” düğmesine basın; izin eksikse hesabı yeniden bağlayıp yayın iznini seçin.', 'The account is connected but publishing access is not verified yet. Select the account in Calendar → Social publications and press “Check publishing access”; if access is missing, reconnect and choose publishing.'), false, '/?tab=calendar&planning=social', 'connections.manage')
          : step('connect', l('Sosyal hesabınızı bağlayın', 'Connect your social account'), l('Proje ayarları → Bağlantılar’da hesabınızı bağlayın ve yayın iznini test edin. Hesap şifreniz Ryzevo’ya girilmez; sağlayıcının kendi ekranında onay verirsiniz.', 'In Project settings → Connections, connect the account and test publishing access. You never type your password into Ryzevo; you approve on the provider’s own screen.'), ready, '/?tab=project&settings=connections', 'connections.manage'),
        step('draft', l('Gönderiyi yazın', 'Write the post'), l('İçerik kütüphanesinde kendiniz yazın veya AI ile taslak çıkarın. Kaydetmek yayınlamak değildir.', 'Write it in the content library or draft it with AI. Saving is not publishing.'), draft(), '/?tab=library', 'content.write'),
        step('rehearsal', l('Gönderimsiz prova yapın', 'Do a no-send rehearsal'), l('Takvim → Sosyal yayınlar’da gönderiyi seçili hesapla deneyin; her şeyin doğru gittiğini görürsünüz ama hiçbir şey yayınlanmaz.', 'In Calendar → Social publications, try the post with the chosen account; you see that it works but nothing is published.'), count("SELECT COUNT(*) n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='rehearsal' AND state='rehearsed'") > 0, '/?tab=calendar&planning=social', 'campaign.approve'),
        step('publish', l('Yayınlayın', 'Publish'), l('Provadan sonra gerçek yayını aynı ekranda onaylayın; isterseniz bir tarih ve saate zamanlayın.', 'After the rehearsal, approve the live post on the same screen, now or at a scheduled time.'), count("SELECT COUNT(*) n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted'") > 0, '/?tab=calendar&planning=social', 'campaign.dispatch', operator(socialPublishingEnabled(), RYZEVO('Gerçek yayın', 'Live publishing'))),
      ] };
    });

  add('inbox', l('Mesaj ve yorumlara cevap ver', 'Answer messages and comments'), l('Müşterilerin yorum ve mesajlarını tek yerden okuyup onaylı cevaplar göndermek.', 'Reading customers’ comments and messages in one place and sending approved replies.'),
    ['mesaj', 'yorum', 'dm', 'cevap', 'yanıt', 'gelen kutusu', 'inbox', 'message', 'comment', 'reply', 'whatsapp', 'müşteri'], () => {
      const reader = hasMessagingDuty(db, scope.subject, ...args, 'source.read'), fresh = reader ? count("SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND state='new'") : 0;
      return { badge: fresh ? { count: fresh, label: l('yeni mesaj/yorum', 'new message(s)/comment(s)') } : null, steps: [
        step('connect', l('Gelen kutusu hesabını bağlayın', 'Connect the inbox account'), l('Facebook Sayfanızı, Instagram hesabınızı veya WhatsApp’ı bağlayıp gelen kutusunda okumayı açın.', 'Connect your Facebook Page, Instagram account or WhatsApp and turn on reading in the inbox.'), count('SELECT COUNT(*) n FROM platform_social_inbox_accounts WHERE organization_id=? AND project_id=?') > 0 || count("SELECT COUNT(*) n FROM platform_whatsapp_hooks WHERE organization_id=? AND project_id=?") > 0 || count('SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=?') > 0, '/?tab=campaigns&campaignView=inbox', 'connections.manage'),
        step('read', l('Mesajları okuyun', 'Read the messages'), l('Gelen kutusunu açın; okuma 30 dakikada bir kendiliğinden de yapılabilir.', 'Open the inbox; reading can also run on its own every 30 minutes.'), count('SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=?') > 0, '/?tab=campaigns&campaignView=inbox', 'duty:source.read'),
        step('reply', l('Cevabı onaylayıp gönderin', 'Approve and send a reply'), l('Cevabı yazın veya AI önerisini düzenleyin; cevap ancak onaydan sonra gider. Mesajlarda 24 saatlik pencere kuralı vardır.', 'Write the reply or edit the AI suggestion; it goes only after approval. Messages have a 24-hour window.'), count("SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND reply_state='sent'") > 0, '/?tab=campaigns&campaignView=inbox', 'duty:publish'),
      ] };
    });

  add('google', l('Google’da bulunun', 'Be found on Google'), l('Sitenizin arama motorları için düzgün okunması ve gerçek arama verisinin izlenmesi.', 'Your site read properly by search engines, with real search data tracked.'),
    ['google', 'seo', 'arama', 'search', 'site', 'web sitesi', 'website', 'sıralama', 'ranking', 'search console', 'blog', 'organik'], () => {
      const open = count("SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open'");
      return { badge: open ? { count: open, label: l('açık SEO bulgusu', 'open SEO finding(s)') } : null, steps: [
        step('website', l('Web sitesi adresinizi girin', 'Enter your website'), l('Proje ayarlarında sitenizin adresini yazın; tarama bu adresi okur.', 'Enter your site address in project settings; the scan reads it.'), Boolean(project.website), '/?tab=project', 'content.write'),
        step('scan', l('Sitenizi tarayın', 'Scan your site'), l('SEO & Blog → Site taraması’nda taramayı başlatın; sorunlar önem sırasıyla listelenir.', 'Start the scan in SEO & Blog → Site scan; issues are listed by importance.'), scanned(), '/?tab=seo', 'content.write'),
        step('fix', l('En önemli sorunu işe dönüştürün', 'Turn the top issue into a task'), l('Bulguyu “İş planına ekle” ile takvime koyun; geliştiriciye verilecek metin hazırdır. Ryzevo sitenizi değiştirmez.', 'Use “Add to work plan” to put a finding on the calendar; the developer text is ready. Ryzevo does not change your site.'), scanned() && (open === 0 || count("SELECT COUNT(*) n FROM platform_seo_findings WHERE organization_id=? AND project_id=? AND state='open' AND task_id IS NOT NULL") > 0), '/?tab=seo', 'content.write'),
        step('search-console', l('Search Console’u bağlayın', 'Connect Search Console'), l('Gerçek arama verisi (hangi sorguyla kaç kişi geldi) buradan gelir.', 'Real search data (which queries brought how many people) comes from here.'), connections(['search_console']) > 0, '/?tab=project&settings=connections&guideProvider=search_console', 'connections.manage'),
        step('schedule', l('Otomatik taramayı açın', 'Turn on the automatic scan'), l('Haftalık veya aylık tarama açın; yeni bir sorun çıkınca “Dikkat gerekenler”de görürsünüz.', 'Turn on a weekly or monthly scan; new issues appear in “Needs attention”.'), count('SELECT COUNT(*) n FROM platform_seo_schedules WHERE organization_id=? AND project_id=?') > 0, '/?tab=seo', 'content.write'),
      ] };
    });

  add('ai_answers', l('AI asistanlarında görünün', 'Appear in AI assistants'), l('ChatGPT, Gemini veya Perplexity’ye müşteriniz sorduğunda markanızın anılması ve sitenizin kaynak gösterilmesi.', 'Your brand named and your site cited when a customer asks ChatGPT, Gemini or Perplexity.'),
    ['ai', 'yapay zeka', 'chatgpt', 'gemini', 'perplexity', 'claude', 'geo', 'llms', 'asistan', 'assistant', 'görünürlük', 'visibility'], () => {
      const questions = count('SELECT COUNT(*) n FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=?');
      const grounded = Boolean(process.env.PLATFORM_GEMINI_API_KEY && /gemini-(?:2|[3-9])/.test(process.env.PLATFORM_GEMINI_MODEL || ''));
      return { steps: [
        step('scan', l('Sitenizi tarayın', 'Scan your site'), l('Tarama, AI tarayıcılarının sitenizi okuyup okuyamadığını da kontrol eder.', 'The scan also checks whether AI crawlers can read your site.'), scanned(), '/?tab=seo', 'content.write'),
        step('access', l('AI tarayıcılarının önündeki engeli kaldırın', 'Remove what blocks AI crawlers'), l('robots.txt AI arama botlarını engelliyorsa veya sayfa JavaScript olmadan boş görünüyorsa, bulgudaki talimatı geliştiricinize verin.', 'If robots.txt blocks AI search bots or the page is empty without JavaScript, give the finding’s instructions to your developer.'), scanned() && openFinding('AI arama botları engelli', 'Sayfa içeriği JavaScript olmadan okunamıyor') === 0, '/?tab=seo', 'content.write'),
        step('llms', l('llms.txt dosyasını yayınlayın', 'Publish llms.txt'), l('SEO & Blog’daki taslağı düzenleyip sitenizin köküne koyun.', 'Edit the draft in SEO & Blog and put it at your site root.'), scanned() && openFinding('llms.txt bulunamadı') === 0, '/?tab=seo', 'content.write'),
        step('questions', l('Müşterinizin sorularını yazın', 'Write your customer’s questions'), l('Müşterinin markanızı bilmeden soracağı birkaç soru (ör. “Kadıköy’de sessiz kafeler hangileri?”).', 'A few questions a customer would ask without knowing your brand (e.g. “Which quiet cafés are in Kadıköy?”).'), questions > 0, '/?tab=seo&seoView=visibility', 'content.write'),
        step('ask', l('Soruları sorun ve sonucu görün', 'Ask and see the result'), l('Cevapta markanız anıldı mı, siteniz kaynak gösterildi mi, hangi rakipler geçti; haftalık takip de açılabilir.', 'Was your brand named, was your site cited, which competitors came up; weekly tracking can be turned on too.'), count("SELECT COUNT(*) n FROM platform_ai_visibility_checks WHERE organization_id=? AND project_id=? AND status='ok'") > 0, '/?tab=seo&seoView=visibility', 'content.write', operator(grounded, RYZEVO('Google aramalı AI modeli', 'The search-grounded AI model'))),
      ] };
    });

  add('email', l('E-posta kampanyası gönder', 'Send an email campaign'), l('İzinli bir kitleye onaylı bir e-postanın gitmesi.', 'An approved email reaching a consented audience.'),
    ['e-posta', 'eposta', 'email', 'mail', 'bülten', 'newsletter', 'kampanya', 'campaign', 'gönder', 'send'], () => {
      const sender = emailSenderReadiness(db, scope);
      return { steps: [
        step('sender', l('Gönderen e-postayı doğrulayın', 'Verify the sender email'), l('Kampanyalar → Gönderen ve pilot’ta SMTP/SES hesabını bağlayın ve alan adınızı DNS kaydıyla doğrulayın.', 'In Campaigns → Sender & pilot, connect SMTP/SES and verify your domain with a DNS record.'), sender.smtpReady && sender.ownership === 'verified', '/?tab=campaigns&campaignView=sender', 'connections.manage'),
        step('audience', l('Kitleyi belirleyin', 'Choose the audience'), l('Kampanyalar → Kitleler’de kimlere gideceğini kurallarla tanımlayın; yalnız izni olan kişiler alıcı olur.', 'In Campaigns → Audiences, define who receives it; only people with consent become recipients.'), count('SELECT COUNT(*) n FROM platform_segments WHERE organization_id=? AND project_id=?') > 0, '/?tab=campaigns&campaignView=segments', 'content.write'),
        step('campaign', l('E-postayı yazın', 'Write the email'), l('Kampanya taslağında konu ve metni yazın, kitleyi bağlayın.', 'Write the subject and text in a campaign draft and attach the audience.'), count("SELECT COUNT(*) n FROM platform_campaigns WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.channels.email')=1") > 0, '/?tab=campaigns', 'content.write'),
        step('approve', l('İnceleyip onaylayın', 'Review and approve'), l('Taslaktaki “İncele ve onayla” ile içerik ve kitle kontrol edilir; onay ayrı bir adımdır.', '“Review and approve” on the draft checks content and audience; approval is a separate step.'), count("SELECT COUNT(*) n FROM platform_campaign_reviews WHERE organization_id=? AND project_id=? AND decision='approved'") > 0, '/?tab=campaigns', 'campaign.approve'),
        step('send', l('Önce sınırlı pilotla gönderin', 'Send a bounded pilot first'), l('Gönderen ve pilot ekranında önce gönderimsiz prova, sonra izinli test alıcılarına sınırlı gönderim.', 'On Sender & pilot, rehearse without sending first, then send to the approved test recipients.'), count("SELECT COUNT(*) n FROM platform_email_pilots WHERE organization_id=? AND project_id=? AND outcome<>'pending'") > 0, '/?tab=campaigns&campaignView=sender', 'campaign.dispatch'),
      ] };
    });

  add('ads', l('Reklam ver', 'Run an ad'), l('Bütçe tavanıyla planlanmış bir reklamın yayına alınması.', 'An ad with a spend cap going live.'),
    ['reklam', 'ads', 'ad', 'meta', 'facebook reklam', 'instagram reklam', 'google ads', 'linkedin ads', 'bütçe', 'budget', 'sponsorlu'], () => {
      const stateIn = (...states: string[]) => count(`SELECT COUNT(*) n FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND state IN (${states.map(() => '?').join(',')})`, ...states) > 0;
      return { steps: [
        step('account', l('Reklam hesabını bağlayın', 'Connect the ad account'), l('Kampanyalar → Reklamlar’da Meta, Google Ads veya LinkedIn reklam hesabınızı bağlayın.', 'In Campaigns → Ads, connect your Meta, Google Ads or LinkedIn ad account.'), connections(['meta_ads', 'google_ads', 'linkedin_ads']) > 0, '/?tab=campaigns&campaignView=ads', 'connections.manage'),
        step('caps', l('Harcama tavanını koyun', 'Set the spend cap'), l('Günlük ve aylık en fazla ne harcanabileceğini belirleyin; hiçbir plan bunu aşamaz.', 'Set the most that can be spent per day and month; no plan can exceed it.'), count('SELECT COUNT(*) n FROM platform_ad_policies WHERE organization_id=? AND project_id=?') > 0, '/?tab=campaigns&campaignView=ads', 'campaign.approve'),
        step('plan', l('Reklam planını hazırlayın', 'Prepare the ad plan'), l('Hedef, bütçe, tarih ve ülkeleri seçin.', 'Choose the objective, budget, dates and countries.'), stateIn('draft', 'approved', 'creating', 'created', 'starting', 'active', 'paused', 'failed'), '/?tab=campaigns&campaignView=ads', 'content.write'),
        step('create', l('Onaylayıp duraklatılmış oluşturun', 'Approve and create it paused'), l('Plan onaylanınca kampanya reklam hesabında duraklatılmış olarak oluşturulur; para harcanmaz.', 'Once approved, the campaign is created paused in the ad account; nothing is spent.'), stateIn('created', 'starting', 'active', 'paused'), '/?tab=campaigns&campaignView=ads', 'campaign.approve'),
        step('start', l('Yayına alın', 'Start it'), l('Başlatmak ayrıca onay ister ve harcama tavanı içinde kalır.', 'Starting needs separate approval and stays within the spend cap.'), stateIn('active'), '/?tab=campaigns&campaignView=ads', 'campaign.dispatch', operator(process.env.PLATFORM_ADS_ENABLED === '1', RYZEVO('Reklamı başlatma', 'Starting ads'))),
      ] };
    });

  add('results', l('Sonuçlarınızı ölçün', 'Measure your results'), l('Hedefinize göre gerçek ölçümlerin gelmesi ve aylık raporun hazırlanması.', 'Real measurements against your goal and a monthly report.'),
    ['sonuç', 'sonuc', 'rapor', 'report', 'analitik', 'analytics', 'ga4', 'google analytics', 'ölçüm', 'measure', 'kpi', 'dönüşüm', 'conversion', 'ziyaret', 'trafik'], () => {
      const pending = count("SELECT COUNT(*) n FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND state='draft'");
      return { badge: pending ? { count: pending, label: l('onay bekleyen rapor', 'report(s) awaiting approval') } : null, steps: [
        step('goal', l('Ölçülecek hedefi ekleyin', 'Add a goal to measure'), l('Proje ayarlarında bir büyüme hedefi ve aşamalarını tanımlayın (ör. ziyaret → teklif isteği).', 'Define a growth goal and its stages in project settings (e.g. visit → quote request).'), project.goals.length > 0, '/?tab=project', 'content.write'),
        step('ga4', l('Google Analytics’i bağlayın', 'Connect Google Analytics'), l('Sitenizdeki ziyaret ve dönüşümler buradan gelir.', 'Visits and conversions on your site come from here.'), connections(['google', 'ga4']) > 0, '/?tab=project&settings=connections&guideProvider=ga4', 'connections.manage'),
        step('rule', l('Ölçüm kuralını seçin', 'Choose the measurement rule'), l('Analitik → Otomatik ölçümler’de hedef aşamasını GA4 olayıyla eşleyin; ölçüm her gün kendiliğinden gelir.', 'In Analytics → Automatic measurements, map the goal stage to a GA4 event; measurements then arrive every day.'), count('SELECT COUNT(*) n FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND enabled=1') > 0, '/?tab=analytics', 'connections.manage'),
        step('measurement', l('İlk ölçümü görün', 'See the first measurement'), l('Ölçüm geldiğinde hedef kartında tarihiyle görünür; veri yoksa sıfır sayılmaz.', 'When it arrives it shows on the goal card with its date; no data is never counted as zero.'), count('SELECT COUNT(*) n FROM platform_metric_entries WHERE organization_id=? AND project_id=?') > 0, '/?tab=analytics', 'read'),
        step('report', l('Aylık raporu onaylayıp paylaşın', 'Approve and share the monthly report'), l('Ay bitince rapor hazırlanır; onaylayıp süreli bir bağlantıyla paylaşabilirsiniz.', 'When a month ends the report is prepared; approve it and share it with an expiring link.'), count("SELECT COUNT(*) n FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND state='approved'") > 0, '/?tab=analytics', 'campaign.approve'),
      ] };
    });

  add('team', l('Ekibinizi ekleyin', 'Add your team'), l('Ekip arkadaşlarınızın kendi rolleriyle projeye katılması.', 'Your teammates joining the project with their own roles.'),
    ['ekip', 'team', 'davet', 'invite', 'kullanıcı', 'user', 'rol', 'role', 'üye', 'member', 'arkadaş'], () => ({ steps: [
      step('invite', l('Davet gönderin', 'Send an invitation'), l('Proje ayarları → Ekip & erişim’de e-posta adresiyle davet edin ve rolünü seçin.', 'In Project settings → Team & access, invite by email and choose the role.'), count('SELECT COUNT(*) n FROM platform_member_invites WHERE organization_id=? AND project_id=?') > 0 || count('SELECT COUNT(*) n FROM platform_memberships WHERE organization_id=? AND project_id=? AND active=1') > 1, '/?tab=project&settings=team', 'members.manage'),
      step('joined', l('Davet kabul edilsin', 'Invitation accepted'), l('Davet edilen kişi bağlantıyla katılır; projede kendi rolünün işlerini görür.', 'The invited person joins with the link and sees the work of their role.'), count('SELECT COUNT(*) n FROM platform_memberships WHERE organization_id=? AND project_id=? AND active=1') > 1, '/?tab=project&settings=team', 'members.manage'),
    ] }));

  add('repurpose', l('Bir paylaşımı başka kanallara uyarla', 'Adapt a post for other channels'), l('Tek bir taslaktan her kanal için ayrı, kanala uygun taslaklar.', 'From one draft, a fitting draft for each channel.'),
    ['uyarla', 'adapt', 'repurpose', 'kanal', 'channel', 'çoğalt', 'kopya', 'dönüştür'], () => ({ steps: [
      step('draft', l('Bir gönderi taslağı kaydedin', 'Save a post draft'), l('İçerik kütüphanesinde bir sosyal medya taslağı yazıp kaydedin.', 'Write and save a social media draft in the content library.'), draft(), '/?tab=library', 'content.write'),
      step('adapt', l('“Diğer kanallara uyarla”yı kullanın', 'Use “Adapt for other channels”'), l('Taslağın altındaki düğmeyle kanalları seçin; kurallarla veya AI ile her kanal için ayrı taslak oluşur.', 'Pick channels with the button under the draft; a separate draft is made for each, by rules or with AI.'), count("SELECT COUNT(*) n FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.repurposedFrom') IS NOT NULL") > 0, '/?tab=library', 'content.write'),
    ] }));

  // The member's own path (Compass) and what waits now decide the order; finished jobs go last.
  const prefs = db.prepare('SELECT preferences_json FROM platform_compass_preferences WHERE user_id=? AND organization_id=? AND project_id=?').get(scope.subject, ...args) as { preferences_json: string } | undefined;
  let intent: string | null = null; try { intent = prefs ? JSON.parse(prefs.preferences_json).intent || null : null; } catch { intent = null; }
  const FOR_INTENT: Record<string, JobId[]> = { leads: ['social_post', 'email', 'ads', 'google'], social: ['social_post', 'inbox', 'repurpose'], retention: ['email', 'results'], seo: ['google', 'ai_answers'], mobile: ['results'] };
  const BASE: JobId[] = ['social_post', 'google', 'ai_answers', 'inbox', 'email', 'results', 'ads', 'repurpose', 'team'];
  const items: JobGuideItem[] = jobs.map(job => {
    const steps = job.steps;
    const done = steps.filter(item => item.state === 'done').length, next = steps.find(item => item.state !== 'done');
    const actionable = steps.some(item => item.state !== 'done' && item.canAct);
    const relevance = (done === steps.length ? -100 : 0) + ((intent && FOR_INTENT[intent]?.includes(job.id)) ? 50 : 0) + (job.badge ? 30 : 0) + (done > 0 && done < steps.length ? 20 : 0) + (actionable ? 10 : -40) + (BASE.length - BASE.indexOf(job.id));
    return { ...job, steps, done, total: steps.length, nextStepId: next?.id || null, complete: !next, relevance };
  })
    // A job is shown when this member can move it forward, or when it is already done (as a record of progress).
    .filter(job => job.complete || job.steps.some(item => item.state !== 'done' && item.canAct))
    .sort((a, b) => b.relevance - a.relevance);
  return { jobs: items, intent };
}
