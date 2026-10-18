import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import {
  clickTrackingUrl,
  listUnsubscribeTarget,
  mailtoUnsubscribeUrl,
  openPixelTag,
  runTrackingTasks,
  safeUnsubscribeUrl,
} from '@/lib/tracking-signature';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const DEFAULT_CTA_TARGET = 'https://www.crewinjob.com/account/login';
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || '';
const EVENT_CONCURRENCY = 10; // email_sent / TrackCampaignDeliveryEvent eşzamanlı backend çağrısı üst sınırı
const UNSUBSCRIBE_RE = /\{\{UNSUBSCRIBE_URL\}\}/g;
const CTA_RE = /\{\{CTA_URL\}\}/g;

// SES bounce/complaint bildirimlerinde userId'yi geri almak için mesaj etiketi ekler.
// SES tag değerleri yalnızca [a-zA-Z0-9_-] kabul eder — userId sayısal olduğundan sorun yok.
// Configuration Set atanmamışsa (env boşsa) tag'ler SES'te izlenmez, header sessizce görmezden gelinir.
function sesHeaders(userId: number | null | undefined, campaign: string | undefined): Record<string, string> | undefined {
  if (userId == null || !SES_CONFIGURATION_SET) return undefined;
  const tags = [`userId=${userId}`];
  if (campaign) tags.push(`campaign=${campaign.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  return {
    'X-SES-CONFIGURATION-SET': SES_CONFIGURATION_SET,
    'X-SES-MESSAGE-TAGS': tags.join(', '),
  };
}

interface RecipientRef {
  email:           string;
  userId?:         number | null;
  unsubscribeUrl?: string | null; // backend'in GetSeafarersByFillBucket ile döndürdüğü opak token'lı link
}

interface SendBody {
  mode:        'single' | 'broadcast';
  to?:         string;
  recipients?: (string | RecipientRef)[];
  subject:     string;
  html:        string; // {{UNSUBSCRIBE_URL}} ve {{CTA_URL}} placeholder'ları içerebilir
  text?:       string; // düz metin gövde — verilirse korunur (aynı placeholder'lar)
  campaign?:   string; // ör. "reactivation-zero" — açılma/tıklama event'lerinde metadata olarak taşınır
  ctaPath?:    string; // ör. "/account/profile?onboarding=cv" — bucket'a özgü hedef sayfa
  // Backend unsubscribe linki olmayan alıcılar (prospect/şirket/manuel adres) için mailto ile
  // "yanıtla-çık" bağlantısı kullanılsın mı? Yalnızca kampanya yürütücüsü açar.
  allowMailtoUnsubscribe?: boolean;
}

function normalizeRecipient(r: string | RecipientRef): RecipientRef {
  return typeof r === 'string' ? { email: r, userId: null, unsubscribeUrl: null } : r;
}

// Placeholder'ları gerçek değerlerle değiştirir + sona görünmez, imzalı açılma piksel'i ekler.
function personalize(html: string, r: RecipientRef, campaign: string | undefined, ctaTarget: string, unsubscribeUrl: string | null): string {
  const withLinks = html
    .replace(UNSUBSCRIBE_RE, unsubscribeUrl || '')
    .replace(CTA_RE, clickTrackingUrl(r.userId, campaign, ctaTarget));
  return withLinks + openPixelTag(r.userId, campaign);
}

// Düz metin gövde: aynı placeholder'lar + unsubscribe linki metinde yoksa sona eklenir.
function personalizeText(text: string | undefined, r: RecipientRef, campaign: string | undefined, ctaTarget: string, unsubscribeUrl: string | null): string | undefined {
  if (!text) return undefined;
  let out = text
    .replace(UNSUBSCRIBE_RE, unsubscribeUrl || '')
    .replace(CTA_RE, clickTrackingUrl(r.userId, campaign, ctaTarget));
  if (unsubscribeUrl && !out.includes(unsubscribeUrl)) out += `\n\n--\nAbonelikten çık / Unsubscribe: ${unsubscribeUrl}`;
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, to, recipients, subject, html, text, campaign, ctaPath } = body;
    // ctaPath yalnızca "/" ile başlayan yol olabilir ("@evil.com" gibi host enjeksiyonunu engeller)
    const ctaTarget = typeof ctaPath === 'string' && /^\/(?!\/)/.test(ctaPath) ? `https://www.crewinjob.com${ctaPath}` : DEFAULT_CTA_TARGET;

    if (!subject || !html) {
      return NextResponse.json({ error: '"subject" ve "html" zorunludur.' }, { status: 400 });
    }

    const send = agentModule('modules/messaging-send.js');
    const api  = agentModule('modules/api.js');
    const needsUnsubscribe = /\{\{UNSUBSCRIBE_URL\}\}/.test(`${html}${text || ''}`);
    const fallbackUnsubscribe = body.allowMailtoUnsubscribe === true ? mailtoUnsubscribeUrl() : null;
    const unsubscribeFor = (r: RecipientRef) => safeUnsubscribeUrl(r.unsubscribeUrl) || fallbackUnsubscribe;

    if (mode === 'single') {
      if (!to) {
        return NextResponse.json({ error: '"to" zorunludur.' }, { status: 400 });
      }
      const ref: RecipientRef = { email: to };
      const unsubscribeUrl = unsubscribeFor(ref);
      if (needsUnsubscribe && !unsubscribeUrl) {
        return NextResponse.json({ error: 'Unsubscribe bağlantısı olmayan alıcılar için marketing e-postası gönderilemez.' }, { status: 400 });
      }
      const result = await send.sendEmail(
        to, subject,
        personalize(html, ref, campaign, ctaTarget, unsubscribeUrl),
        personalizeText(text, ref, campaign, ctaTarget, unsubscribeUrl),
        undefined,
        listUnsubscribeTarget(unsubscribeUrl),
      );
      return NextResponse.json(result);
    }

    if (mode === 'broadcast') {
      if (!recipients || recipients.length === 0) {
        return NextResponse.json({ error: '"recipients" zorunludur.' }, { status: 400 });
      }
      if (recipients.length > 500) {
        return NextResponse.json({ error: 'İstek başına en fazla 500 alıcı.' }, { status: 400 });
      }

      const refs = recipients.map(normalizeRecipient);
      if (needsUnsubscribe && refs.some(recipient => !unsubscribeFor(recipient))) {
        return NextResponse.json({ error: 'Unsubscribe bağlantısı olmayan alıcılar için marketing e-postası gönderilemez.' }, { status: 400 });
      }
      const items = refs.map(r => {
        const unsubscribeUrl = unsubscribeFor(r);
        return {
          to:             r.email,
          html:           personalize(html, r, campaign, ctaTarget, unsubscribeUrl),
          text:           personalizeText(text, r, campaign, ctaTarget, unsubscribeUrl),
          headers:        sesHeaders(r.userId, campaign),
          unsubscribeUrl: listUnsubscribeTarget(unsubscribeUrl),
        };
      });

      const result = await send.broadcastPersonalizedEmail(items, subject);

      // email_sent event'i — best-effort, gönderim sonucunu bloklamaz; en fazla EVENT_CONCURRENCY eşzamanlı çağrı
      const withUserId = refs.filter(r => r.userId != null);
      if (withUserId.length > 0) {
        const sendResults = Array.isArray(result.results) ? result.results as Array<{ to?: string; success?: boolean; messageId?: string }> : [];
        const resultByEmail = new Map(sendResults.map(item => [String(item.to || '').toLowerCase(), item]));
        const tasks = withUserId.flatMap(r => {
          const sendResult = resultByEmail.get(r.email.toLowerCase());
          if (sendResult && !sendResult.success) return [];
          const calls: Array<() => Promise<unknown>> = [
            () => api.trackActivationEvent('email_sent', r.userId, { subject, campaign }, 'marketing-panel'),
          ];
          if (campaign) calls.push(() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
            userId: r.userId,
            campaignId: campaign,
            channel: 'email',
            eventType: 'sent',
            providerMessageId: sendResult?.messageId,
            recipientAddress: r.email,
            occurredAt: new Date().toISOString(),
          }));
          return calls;
        });
        void runTrackingTasks(tasks, EVENT_CONCURRENCY);
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Geçersiz mod: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
