import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { claimTrackingHit, runTrackingHit, verifyTracking } from '@/lib/tracking-signature';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// 1x1 şeffaf PNG — e-posta istemcileri (Gmail, Outlook vb.) görseli açınca bu isteği tetikler
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// GET /api/track/open?uid={userId}&campaign={campaign}&sig={hmac}
// E-posta HTML'inin altına <img src="..."> olarak gömülür. Event tracking best-effort —
// piksel her koşulda döner. İmza (sig) yoksa veya geçersizse event KAYDEDİLMEZ (sahte açılma engeli).
export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid') || '';
  const campaign = request.nextUrl.searchParams.get('campaign') || undefined;
  const sig = request.nextUrl.searchParams.get('sig');

  const valid = /^\d{1,12}$/.test(uid)
    && (!campaign || campaign.length <= 120)
    && verifyTracking(uid, campaign, sig);

  if (valid && claimTrackingHit(`open|${uid}|${campaign ?? ''}`)) {
    try {
      const api = agentModule('modules/api.js');
      const userId = Number(uid);
      void runTrackingHit([
        () => api.trackActivationEvent('email_opened', userId, { campaign }, 'email-pixel'),
        ...(campaign ? [() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
          userId, campaignId: campaign, channel: 'email', eventType: 'opened', occurredAt: new Date().toISOString(),
        })] : []),
      ]);
    } catch { /* ignore */ }
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Content-Length': String(PIXEL.length),
    },
  });
}
