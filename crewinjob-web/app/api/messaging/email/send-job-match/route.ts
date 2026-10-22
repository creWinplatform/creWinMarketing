import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { listUnsubscribeTarget, openPixelTag, runTrackingTasks, safeUnsubscribeUrl } from '@/lib/tracking-signature';
import { legacySuppressed } from '@/lib/legacy-unsubscribe';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || '';
const EVENT_CONCURRENCY = 10;

function sesHeaders(userId: number | null | undefined, campaign: string): Record<string, string> | undefined {
  if (userId == null || !SES_CONFIGURATION_SET) return undefined;
  const tags = [`userId=${userId}`, `campaign=${campaign.replace(/[^a-zA-Z0-9_-]/g, '_')}`];
  return { 'X-SES-CONFIGURATION-SET': SES_CONFIGURATION_SET, 'X-SES-MESSAGE-TAGS': tags.join(', ') };
}

interface Recipient {
  email:           string;
  userId?:         number | null;
  nationality?:    string | null;   // ISO 3166-1 alpha-2 → dil otomatik belirlenir
  unsubscribeUrl?: string | null;   // backend'in ürettiği opak token'lı link (email/send ile aynı mekanizma)
}

interface SendJobMatchBody {
  recipients: Recipient[];
  lang?:      string;    // fallback dil — nationality yoksa kullanılır
  campaign?:  string;
}

// Her userId için Ilan/GetAll?userId=X çağrısı yapılır.
// Paralel istekleri kontrol altında tutmak için N'li gruplara bölünür.
async function fetchJobsInBatches(
  api: { getJobListings: (userId: number | null, limit: number) => Promise<object[]> },
  recipients: Recipient[],
  batchSize = 15,
): Promise<Map<string, object[]>> {
  const result = new Map<string, object[]>();
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (r) => {
        try {
          const jobs = await api.getJobListings(r.userId ?? null, 6);
          result.set(r.email, jobs);
        } catch {
          result.set(r.email, []); // hata durumunda boş liste — gönderimi bloklamaz
        }
      }),
    );
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body: SendJobMatchBody = await request.json();
    const { lang = 'tr', campaign = 'job-match' } = body;
    let { recipients } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: '"recipients" zorunludur.' }, { status: 400 });
    }
    if (recipients.length > 500) {
      return NextResponse.json({ error: 'İstek başına en fazla 500 alıcı.' }, { status: 400 });
    }
    // email/send ile aynı kural: backend'in opak unsubscribe linki olmayan alıcıya marketing e-postası gitmez
    // (önceden '#' ile ölü link gidiyordu).
    // Addresses that unsubscribed through the panel's own link are skipped too.
    const suppressed = legacySuppressed(recipients.map(r => r.email));
    recipients = recipients.filter(r => !suppressed.has(String(r.email).trim().toLowerCase()));
    if (!recipients.length) return NextResponse.json({ sent: 0, failed: 0, errors: [], results: [], suppressed: suppressed.size });
    const missingUnsubscribe = recipients.filter(r => !safeUnsubscribeUrl(r.unsubscribeUrl)).length;
    if (missingUnsubscribe > 0) {
      return NextResponse.json({ error: `Unsubscribe bağlantısı olmayan alıcılar için marketing e-postası gönderilemez (${missingUnsubscribe} alıcı).` }, { status: 400 });
    }

    const api       = agentModule('modules/api.js');
    const retention = agentModule('modules/retention.js');
    const send      = agentModule('modules/messaging-send.js');

    // Her alıcı için kişisel ilan listesi çek (userId yoksa genel liste)
    const jobsMap   = await fetchJobsInBatches(api, recipients);

    // Her alıcı için kişiselleştirilmiş konu + HTML oluştur
    // nationality varsa retention.js'deki NATIONALITY_TO_LANGUAGE_CODE'dan dil otomatik çözülür;
    // yoksa route'a gelen fallback lang kullanılır
    const items = recipients.map((r) => {
      const jobs           = jobsMap.get(r.email) ?? [];
      const unsubscribeUrl = safeUnsubscribeUrl(r.unsubscribeUrl)!;
      const { subject, html } = retention.renderJobMatchEmail(jobs, {
        nationality:    r.nationality || null,
        lang,                                   // nationality eşleşmezse fallback
        unsubscribeUrl,
      });
      return {
        to:             r.email,
        subject,                                // alıcının dilindeki konu (broadcast item.subject'i kullanır)
        html:           html + openPixelTag(r.userId, campaign),
        headers:        sesHeaders(r.userId, campaign),
        unsubscribeUrl: listUnsubscribeTarget(unsubscribeUrl),
      };
    });

    // Tüm e-postaları gönder — konu her item'da; ikinci argüman yalnızca yedek
    const result = await send.broadcastPersonalizedEmail(items, 'Size Uygun İlanlar');

    // email_sent event — best-effort, yalnızca başarıyla gidenler; en fazla EVENT_CONCURRENCY eşzamanlı çağrı
    const sendResults = Array.isArray(result.results) ? result.results as Array<{ to?: string; success?: boolean }> : [];
    const failedEmails = new Set(sendResults.filter(item => !item.success).map(item => String(item.to || '').toLowerCase()));
    const withUserId = recipients.filter(r => r.userId != null && !failedEmails.has(r.email.toLowerCase()));
    if (withUserId.length > 0) {
      void runTrackingTasks(
        withUserId.map(r => () => api.trackActivationEvent('email_sent', r.userId, { campaign }, 'marketing-panel')),
        EVENT_CONCURRENCY,
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
