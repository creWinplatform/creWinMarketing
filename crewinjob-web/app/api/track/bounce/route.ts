import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { runTrackingTasks } from '@/lib/tracking-signature';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const nativeRequire = eval('require') as NodeRequire;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SnsMessage = Record<string, any>;

// Tek bildirimde işlenecek en fazla alıcı — backend çağrı yelpazesini sınırlar
const MAX_RECIPIENTS_PER_NOTIFICATION = 50;

function validateSns(message: SnsMessage): Promise<SnsMessage> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MessageValidator = nativeRequire('sns-validator');
    const validator = new MessageValidator();
    validator.validate(message, (err: Error | null, validated: SnsMessage) => {
      if (err) reject(err);
      else resolve(validated);
    });
  });
}

/** SES_SNS_TOPIC_ARN (virgülle ayrılmış) — boşsa hiçbir topic kabul edilmez. */
function allowedTopicArns(): string[] {
  return (process.env.SES_SNS_TOPIC_ARN || '').split(',').map(item => item.trim()).filter(Boolean);
}

function maskEmail(value: string): string {
  const [local, domain] = String(value || '').split('@');
  return domain ? `${local.slice(0, 2)}***@${domain}` : '***';
}

interface SesMailHeader { name: string; value: string }

interface SesEvent {
  eventType?: string;        // Configuration Set event publishing
  notificationType?: string; // Identity bildirimleri
  mail: {
    messageId?: string;
    tags?: Record<string, string[]>;
    headers?: SesMailHeader[];
    commonHeaders?: { subject?: string };
  };
  bounce?: {
    bounceType: string;
    bounceSubType: string;
    bouncedRecipients: { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: {
    complainedRecipients: { emailAddress: string }[];
    complaintFeedbackType?: string;
  };
}

/** Gönderimde eklenen List-Unsubscribe başlığından backend'in opak unsubscribe token'ını çıkarır. */
function unsubscribeTokenFromHeaders(headers: SesMailHeader[] | undefined): string | null {
  const header = (headers || []).find(item => String(item?.name || '').toLowerCase() === 'list-unsubscribe');
  if (!header?.value) return null;
  for (const match of Array.from(String(header.value).matchAll(/<([^>]+)>/g))) {
    try {
      const url = new URL(match[1]);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      const token = url.searchParams.get('token');
      if (token) return token;
    } catch { /* sonraki */ }
  }
  return null;
}

/**
 * POST /api/track/bounce — AWS SNS webhook (SES Configuration Set → SNS Topic → bu endpoint).
 *
 * AWS tarafında kurulum (bu route'u yazmak SNS aboneliğini otomatik yaratmaz):
 * 1. SES konsolu → Configuration sets → yeni set oluştur (adını SES_CONFIGURATION_SET'e yaz)
 * 2. Bu set için "Event destination" ekle → tip: SNS → event: Bounce + Complaint
 * 3. SNS konsolu → o topic'e "HTTPS" aboneliği ekle → Endpoint: {APP_URL}/api/track/bounce
 *    (localhost ULAŞILAMAZ — bu adres public/deploy edilmiş bir domain olmalı)
 * 4. Topic ARN'ini SES_SNS_TOPIC_ARN env'ine yaz (birden fazlaysa virgülle). Tanımlı değilse
 *    tüm bildirimler reddedilir ve abonelik onaylanmaz.
 * 5. SNS abonelik onayı yalnızca izinli topic'ler için bu endpoint tarafından OTOMATİK yapılır.
 *
 * userId eşleşmesi: gönderim sırasında X-SES-MESSAGE-TAGS header'ına eklenen userId tag'i,
 * SES bildiriminde mail.tags.userId olarak geri döner (bkz. /api/messaging/email/send).
 */
export async function POST(request: NextRequest) {
  let body: SnsMessage;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON gövde' }, { status: 400 });
  }

  // Topic allowlist — imza doğrulamasından (sertifika indirme) önce ucuz kontrol
  const allowed = allowedTopicArns();
  if (!allowed.length) {
    console.warn('[track/bounce] SES_SNS_TOPIC_ARN tanımlı değil — SNS bildirimi reddedildi, abonelik onaylanmadı.');
    return NextResponse.json({ error: 'SNS topic allowlist yapılandırılmamış.' }, { status: 403 });
  }
  if (typeof body?.TopicArn !== 'string' || !allowed.includes(body.TopicArn)) {
    console.warn('[track/bounce] İzin verilmeyen SNS topic reddedildi.');
    return NextResponse.json({ error: 'İzin verilmeyen SNS topic.' }, { status: 403 });
  }

  let validated: SnsMessage;
  try {
    validated = await validateSns(body);
  } catch (err: unknown) {
    console.warn('[track/bounce] SNS imza doğrulaması başarısız:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'SNS imza doğrulaması başarısız.' }, { status: 400 });
  }
  if (!allowed.includes(String(validated.TopicArn))) {
    return NextResponse.json({ error: 'İzin verilmeyen SNS topic.' }, { status: 403 });
  }

  // SNS abonelik onay handshake'i — yalnızca izinli topic ve AWS SNS adresi
  if (validated.Type === 'SubscriptionConfirmation') {
    let subscribeUrl: URL;
    try {
      subscribeUrl = new URL(String(validated.SubscribeURL));
    } catch {
      return NextResponse.json({ error: 'Geçersiz SubscribeURL.' }, { status: 400 });
    }
    if (subscribeUrl.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(subscribeUrl.hostname)) {
      return NextResponse.json({ error: 'Geçersiz SubscribeURL.' }, { status: 400 });
    }
    try {
      const res = await fetch(subscribeUrl.toString(), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return NextResponse.json({ confirmed: true });
    } catch (err: unknown) {
      console.error('[track/bounce] Abonelik onayı başarısız:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Abonelik onayı başarısız.' }, { status: 500 });
    }
  }

  if (validated.Type !== 'Notification') {
    return NextResponse.json({ ignored: validated.Type });
  }

  let event: SesEvent;
  try {
    event = JSON.parse(validated.Message);
  } catch {
    return NextResponse.json({ error: 'SES event JSON parse edilemedi' }, { status: 400 });
  }

  const eventType = event.eventType || event.notificationType;
  const userIdTag = event.mail?.tags?.userId?.[0];
  const campaignTag = event.mail?.tags?.campaign?.[0];
  const userId = userIdTag && /^\d{1,12}$/.test(userIdTag) ? Number(userIdTag) : null;

  if (eventType === 'Bounce' && event.bounce) {
    const { bounceType, bounceSubType } = event.bounce;
    const bouncedRecipients = (event.bounce.bouncedRecipients || []).slice(0, MAX_RECIPIENTS_PER_NOTIFICATION);
    if (userId != null) {
      try {
        const api = agentModule('modules/api.js');
        void runTrackingTasks(bouncedRecipients.flatMap(r => [
          () => api.trackActivationEvent('email_bounced', userId, {
            email: r.emailAddress,
            bounceType,
            bounceSubType,
            campaign: campaignTag,
          }, 'ses-webhook'),
          ...(campaignTag ? [() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
            userId, campaignId: campaignTag, channel: 'email', eventType: 'bounced',
            providerMessageId: event.mail.messageId, recipientAddress: r.emailAddress,
            occurredAt: new Date().toISOString(), metadataJson: JSON.stringify({ bounceType, bounceSubType }),
          })] : []),
        ]), 5);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: true, type: 'bounce', recipients: bouncedRecipients.length, hasUserId: userId != null });
  }

  if (eventType === 'Complaint' && event.complaint) {
    // Şikayet = bastırma (suppression) sinyali. TRACKED_EVENT_NAMES'te 'email_complained' YOK;
    // backend'de userId ile bastırma uç noktası da yok. Mevcut tek yol: gönderimde eklenen
    // List-Unsubscribe başlığındaki opak token ile ProcessUnsubscribe (anonim) çağrısı.
    const recipients = (event.complaint.complainedRecipients || []).slice(0, MAX_RECIPIENTS_PER_NOTIFICATION);
    const feedbackType = event.complaint.complaintFeedbackType;
    const token = unsubscribeTokenFromHeaders(event.mail?.headers);
    console.warn(
      `[track/bounce] SES complaint alındı: ${recipients.map(r => maskEmail(r.emailAddress)).join(', ') || '-'}`
      + ` · userId=${userId ?? '-'} · campaign=${campaignTag ?? '-'} · bastırma=${token ? 'unsubscribe token ile' : 'YAPILAMADI (token yok)'}`,
    );
    try {
      const api = agentModule('modules/api.js');
      const tasks: Array<() => Promise<unknown>> = [];
      if (token) {
        tasks.push(async () => {
          try {
            await api.growthAnalyticsPublicPost('ProcessUnsubscribe', { token, channel: 'email', reason: 'complaint' });
          } catch (error) {
            // Backend 'complaint' gerekçesini tanımıyorsa kullanıcı talebi olarak yeniden dene
            if (Number((error as { status?: number }).status || 0) !== 400) throw error;
            await api.growthAnalyticsPublicPost('ProcessUnsubscribe', { token, channel: 'email', reason: 'user_request' });
          }
        });
      }
      if (userId != null && campaignTag) {
        tasks.push(() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
          userId, campaignId: campaignTag, channel: 'email', eventType: 'complained',
          providerMessageId: event.mail.messageId, occurredAt: new Date().toISOString(),
          metadataJson: JSON.stringify({ feedbackType: feedbackType ?? null }),
        }));
      }
      void runTrackingTasks(tasks, 2);
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, type: 'complaint', recipients: recipients.length, suppressed: Boolean(token) });
  }

  return NextResponse.json({ ignored: eventType });
}
