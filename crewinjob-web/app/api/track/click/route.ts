import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { claimTrackingHit, runTrackingHit, verifyTracking } from '@/lib/tracking-signature';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// Sadece bu domainlere ve yalnızca https ile yönlendirmeye izin verilir — açık yönlendirme (open redirect) riskini önler.
const ALLOWED_HOSTS = ['crewinjob.com', 'www.crewinjob.com'];
const DEFAULT_TARGET = 'https://crewinjob.com/profil';

function safeTarget(raw: string | null): URL {
  try {
    const target = new URL(raw || DEFAULT_TARGET);
    if (target.protocol === 'https:' && ALLOWED_HOSTS.includes(target.hostname) && !target.port && !target.username && !target.password) {
      return target;
    }
  } catch { /* geçersiz URL → varsayılan */ }
  return new URL(DEFAULT_TARGET);
}

// GET /api/track/click?uid={userId}&campaign={campaign}&url={encodedTargetUrl}&sig={hmac}
// E-posta içindeki CTA linki bu endpoint'e sarılır; tıklama loglanır, sonra gerçek hedefe 302 ile gider.
// İmza (sig) yoksa/geçersizse yönlendirme yine yapılır (eski e-postalar çalışsın) ama event KAYDEDİLMEZ.
export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid') || '';
  const campaign = request.nextUrl.searchParams.get('campaign') || undefined;
  const sig = request.nextUrl.searchParams.get('sig');
  const target = safeTarget(request.nextUrl.searchParams.get('url'));

  const valid = /^\d{1,12}$/.test(uid)
    && (!campaign || campaign.length <= 120)
    && verifyTracking(uid, campaign, sig);

  if (valid && claimTrackingHit(`click|${uid}|${campaign ?? ''}|${target.toString()}`)) {
    try {
      const api = agentModule('modules/api.js');
      const userId = Number(uid);
      void runTrackingHit([
        () => api.trackActivationEvent('email_clicked', userId, { campaign, url: target.toString() }, 'email-link'),
        ...(campaign ? [() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
          userId, campaignId: campaign, channel: 'email', eventType: 'clicked', occurredAt: new Date().toISOString(),
          metadataJson: JSON.stringify({ url: target.toString() }),
        })] : []),
      ]);
    } catch { /* ignore */ }
  }

  return NextResponse.redirect(target, { status: 302 });
}
