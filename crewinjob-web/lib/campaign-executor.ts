import { internalFetch } from '@/lib/internal-fetch';
import {
  appendUtm,
  audienceSegmentFilters,
  getCampaign,
  updateCampaign,
  updateDelivery,
  type CampaignDelivery,
  type UnifiedCampaign,
} from '@/lib/campaigns';
import type { AdPlatform, CreateCampaignRequest } from '@/lib/ads-types';
import { agentModule } from '@/lib/agent-bridge';
import { extractPostId } from '@/lib/post-history';

type JsonObject = Record<string, unknown>;

// Self-call'lar internalFetch ile: hedef her zaman bu süreç (127.0.0.1:$PORT), kısa ömürlü servis cookie'si
async function callApi(path: string, body?: unknown): Promise<JsonObject> {
  const res = await internalFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, 'campaign-runner');
  const text = await res.text();
  let data: JsonObject = {};
  try { data = text ? JSON.parse(text) as JsonObject : {}; } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(String(data.error || data.message || `HTTP ${res.status}`));
  return data;
}

function configuredAdPlatform(platform: AdPlatform): boolean {
  if (platform === 'meta') return Boolean(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
  if (platform === 'linkedin') return Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ADS_ACCOUNT_ID);
  return Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET
    && process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID);
}

function adObjective(platform: AdPlatform, objective: UnifiedCampaign['objective']): string {
  if (platform === 'meta') {
    return objective === 'awareness' ? 'OUTCOME_AWARENESS' : objective === 'traffic' ? 'OUTCOME_TRAFFIC' : 'OUTCOME_LEADS';
  }
  if (platform === 'linkedin') {
    return objective === 'awareness' ? 'BRAND_AWARENESS' : objective === 'traffic' ? 'WEBSITE_VISITS' : 'LEAD_GENERATION';
  }
  return objective === 'awareness' ? 'DISPLAY' : 'SEARCH';
}

// Her pazarlama e-postasında abonelikten çıkma bağlantısı olmalı. {{UNSUBSCRIBE_URL}} /api/messaging/email/send
// tarafından alıcı bazında doldurulur (backend opak linki; yoksa — prospect/şirket/manuel — mailto yedeği).
const UNSUBSCRIBE_FOOTER = '<p style="margin-top:24px;font-size:12px;line-height:1.5;color:#6b7280">'
  + 'Bu e-postayı CrewinJob iletişim listesinde olduğunuz için aldınız. / You received this email because you are on the CrewinJob mailing list. '
  + '<a href="{{UNSUBSCRIBE_URL}}" style="color:#6b7280;text-decoration:underline">Abonelikten çık / Unsubscribe</a></p>';

function htmlFromText(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;line-height:1.6">${escaped}${UNSUBSCRIBE_FOOTER}</div>`;
}

function withUnsubscribeFooter(html: string): string {
  if (/\{\{UNSUBSCRIBE_URL\}\}/.test(html)) return html;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${UNSUBSCRIBE_FOOTER}</body>`) : `${html}${UNSUBSCRIBE_FOOTER}`;
}

// {{CTA_URL}} hedefi: kampanyanın ctaUrl'i (UTM'li) crewinjob.com üzerindeyse yolu email/send'e ctaPath olarak geçer.
function ctaPathFor(campaign: UnifiedCampaign): string | undefined {
  const raw = campaign.content.ctaUrl;
  if (!raw) return undefined;
  try {
    const url = new URL(appendUtm(raw, campaign, 'email', 'email'));
    if (url.protocol === 'https:' && ['crewinjob.com', 'www.crewinjob.com'].includes(url.hostname)) return `${url.pathname}${url.search}`;
  } catch { /* geçersiz URL → varsayılan CTA */ }
  return undefined;
}

interface EmailRecipient {
  email: string;
  userId?: number | null;
  unsubscribeUrl?: string | null;
}

async function loadEmailRecipients(campaign: UnifiedCampaign) {
  const unique = new Map<string, EmailRecipient>();
  campaign.audience.manualEmails?.forEach(email => unique.set(email.toLowerCase(), { email }));
  // Şirket kitlesi için seafarer profil sorgusunu çalıştırma; boş filtreler
  // backend'de geniş bir aday kitlesine dönüşebilir. CRM endpoint'i gelene
  // kadar yalnızca panelde açıkça verilen şirket adresleri kullanılır.
  if (['maritime_businesses', 'company_prospects'].includes(campaign.audience.audienceType || '')) {
    const items = Array.from(unique.values()).slice(0, 500);
    return { items, totalCount: items.length, hasMore: false };
  }
  const api = agentModule<{ growthAnalyticsGet: (name: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }>('modules/api.js');
  // Önizleme (audience-preview) ile aynı filtreler: uyruk + aktif/pasif dahil
  const result = await api.growthAnalyticsGet('GetCampaignRecipients', {
    campaignId: campaign.backendId || undefined,
    profileBuckets: campaign.audience.fillBuckets,
    ...audienceSegmentFilters(campaign.audience),
    channel: 'email',
    cursor: 0,
    take: 500,
  });
  const items = Array.isArray(result.recipients) ? result.recipients as Array<Record<string, unknown>> : [];
  for (const item of items) {
    const email = String(item.recipientAddress || '').trim();
    if (email) unique.set(email.toLowerCase(), {
      email,
      userId: typeof item.userId === 'number' ? item.userId : null,
      unsubscribeUrl: typeof item.unsubscribeUrl === 'string' ? item.unsubscribeUrl : null,
    });
  }
  const totalCount = Number(result.totalCount || items.length) + (campaign.audience.manualEmails?.length || 0);
  return {
    items: Array.from(unique.values()).slice(0, 500),
    totalCount,
    hasMore: Boolean(result.hasMore) || totalCount > 500,
  };
}

async function runDelivery(campaign: UnifiedCampaign, delivery: CampaignDelivery): Promise<Partial<CampaignDelivery>> {
  const channel = delivery.channel;
  if (channel.startsWith('social:')) {
    const platform = channel.split(':')[1];
    const content = appendUtm(campaign.content.perPlatformContent?.[platform] || campaign.content.text, campaign, platform, 'organic_social');
    const data = await callApi('/api/social/post', {
      platforms: [platform], content,
      imageData: campaign.content.imageData, imageMime: campaign.content.imageMime,
    });
    const result = Array.isArray(data.results) ? data.results[0] as Record<string, unknown> : undefined;
    if (!result?.success) throw new Error(String(result?.error || 'Paylaşım başarısız'));
    const url = String(result.url || '');
    // /api/social/post gerçek platform postId'sini döndürür; yoksa URL'den çıkar
    const postId = String(result.postId || (url ? extractPostId(platform, url) : '') || `${campaign.id}_${platform}`);
    await callApi('/api/data/post-history', {
      platform,
      postId,
      postUrl: url || undefined,
      content,
      publishedAt: Date.now(),
      campaignId: campaign.id,
      deliveryId: delivery.id,
    });
    return { status: 'succeeded', url, sentCount: 1, failedCount: 0 };
  }

  if (channel === 'email') {
    const audience = await loadEmailRecipients(campaign);
    const recipients = audience.items;
    if (!recipients.length) throw new Error('Seçilen segmentlerde e-posta alıcısı bulunamadı');
    const text = appendUtm(campaign.content.text, campaign, 'email', 'email');
    // text zaten UTM'li; htmlFromText çıktısına ikinci kez appendUtm uygulanmaz (&amp; içeren URL'ler bozulurdu)
    const html = withUnsubscribeFooter(campaign.content.html ? appendUtm(campaign.content.html, campaign, 'email', 'email') : htmlFromText(text));
    const data = await callApi('/api/messaging/email/send', {
      mode: 'broadcast', recipients,
      subject: campaign.content.subject || campaign.name,
      // text: düz metin gövde olarak korunur (aksi halde HTML'den türetilirdi)
      html, text, campaign: campaign.id,
      ctaPath: ctaPathFor(campaign),
      // Backend unsubscribe linki olmayan (prospect/şirket/manuel) adreslere mailto ile çıkma bağlantısı
      allowMailtoUnsubscribe: true,
    });
    const failed = Number(data.failed || 0);
    const deferred = audience.hasMore ? Math.max(0, audience.totalCount - recipients.length) : 0;
    if (failed >= recipients.length) throw new Error(String(data.error || 'E-posta gönderimi başarısız'));
    const notes = [failed ? `${failed} alıcıya gönderilemedi` : '', deferred ? `${deferred} alıcı 500 kişilik senkron gönderim sınırının dışında kaldı` : ''].filter(Boolean);
    return { status: 'succeeded', sentCount: Number(data.sent ?? recipients.length - failed), failedCount: failed + deferred, error: notes.join(' · ') || undefined };
  }

  if (channel === 'whatsapp') {
    const numbers = campaign.audience.whatsappNumbers || [];
    if (!campaign.audience.consentConfirmed) throw new Error('WhatsApp alıcı izni onaylanmadı');
    if (!numbers.length) throw new Error('WhatsApp alıcısı eklenmedi');
    // Rota yalnız izni kayıtlı ve çıkış yapmamış numaralara gönderir; diğerleri skipped olarak sayılır (hiçbiri izinli değilse 409 → hata)
    const data = await callApi('/api/messaging/whatsapp/send', {
      mode: 'broadcast', numbers,
      text: appendUtm(campaign.content.text, campaign, 'whatsapp', 'messaging'),
    });
    const failed = Number(data.failed || 0);
    const skipped = Object.values((data.skipped || {}) as Record<string, unknown>).reduce<number>((sum, count) => sum + Number(count || 0), 0);
    const notes = [failed ? `${failed} alıcıya gönderilemedi` : '', skipped ? `${skipped} numara izin kaydı olmadığı veya çıkış yaptığı için atlandı` : ''].filter(Boolean);
    return { status: 'succeeded', sentCount: Number(data.sent || 0), failedCount: failed + skipped, error: notes.join(' · ') || undefined };
  }

  if (channel === 'telegram') {
    const ids = campaign.audience.telegramChatIds || [];
    const channelMode = ids.length === 0;
    if (!channelMode && !campaign.audience.consentConfirmed) throw new Error('Telegram alıcı izni onaylanmadı');
    const data = await callApi('/api/messaging/telegram/send', {
      mode: channelMode ? 'channel' : 'broadcast',
      ...(channelMode ? {} : { chatIds: ids }),
      text: appendUtm(campaign.content.text, campaign, 'telegram', 'messaging'),
    });
    const failed = Number(data.failed || 0);
    return { status: 'succeeded', sentCount: channelMode ? 1 : Math.max(0, ids.length - failed), failedCount: failed, error: failed ? `${failed} alıcıya gönderilemedi` : undefined };
  }

  if (channel.startsWith('ads:')) {
    const platform = channel.split(':')[1] as AdPlatform;
    if (!configuredAdPlatform(platform)) return { status: 'skipped', error: `${platform} reklam hesabı yapılandırılmamış` };
    const budgetDaily = campaign.budget.dailyByPlatform[platform] || 10;
    const request: CreateCampaignRequest = {
      platform,
      name: campaign.name,
      objective: adObjective(platform, campaign.objective),
      budgetDaily,
      startDate: new Date().toISOString().slice(0, 10),
      targeting: { countries: campaign.audience.countries?.length ? campaign.audience.countries : ['TR'] },
    };
    const data = await callApi(`/api/ads/${platform}/campaigns`, request);
    if (!data.success) throw new Error(String(data.error || 'Reklam kampanyası oluşturulamadı'));
    return { status: 'succeeded', externalId: String(data.campaignId), sentCount: 1, failedCount: 0 };
  }

  return { status: 'skipped', error: 'Desteklenmeyen kanal' };
}

/** Kampanyanın teslimatlarını sırayla çalıştırır. Çağıran taraf önce claimCampaign/claimDueCampaigns ile claim etmelidir. */
export async function executeCampaign(id: string): Promise<UnifiedCampaign> {
  let campaign = getCampaign(id);
  if (!campaign) throw new Error('Kampanya bulunamadı');
  if (campaign.status === 'cancelled') throw new Error('İptal edilmiş kampanya çalıştırılamaz');

  campaign = (await updateCampaign(id, { status: 'running', launchedAt: campaign.launchedAt || new Date().toISOString() }))!;
  for (const original of campaign.deliveries) {
    if (original.status === 'succeeded' || original.status === 'skipped') continue;
    await updateDelivery(id, original.id, { status: 'running', attempts: original.attempts + 1, startedAt: new Date().toISOString(), error: undefined });
    try {
      const result = await runDelivery(campaign, original);
      await updateDelivery(id, original.id, { ...result, completedAt: new Date().toISOString() });
    } catch (error) {
      await updateDelivery(id, original.id, {
        status: 'failed', completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      });
    }
    campaign = getCampaign(id)!;
  }

  const succeeded = campaign.deliveries.filter(item => item.status === 'succeeded').length;
  const failed = campaign.deliveries.filter(item => item.status === 'failed').length;
  const incomplete = campaign.deliveries.some(item => item.status === 'skipped' || (item.failedCount || 0) > 0);
  const pending = campaign.deliveries.filter(item => ['pending', 'running'].includes(item.status)).length;
  const status = pending ? 'running' : failed ? (succeeded ? 'partial' : 'failed') : incomplete ? (succeeded ? 'partial' : 'failed') : 'completed';
  return (await updateCampaign(id, { status, ...(pending ? {} : { completedAt: new Date().toISOString() }) }))!;
}
