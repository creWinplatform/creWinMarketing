import { NextRequest, NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/auth';
import { executeCampaign } from '@/lib/campaign-executor';
import { canUseBackendDispatch, createCampaignDispatch } from '@/lib/campaign-dispatch';
import { claimDueCampaigns, releaseCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Zamanı gelen kampanyaları çalıştırır (cron). Self-call'lar executor içinde internalFetch ile
// internalBaseUrl()'e gider — NEXT_PUBLIC_APP_URL veya Host başlığı kullanılmaz.
export async function POST(req: NextRequest) {
  if (!hasValidCronSecret(req)) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 });

  // Claim: zamanı gelenler kilit altında 'running'e çekilir → çakışan cron/"şimdi başlat" çift gönderim yapamaz
  const due = await claimDueCampaigns();
  const results = [];
  for (const campaign of due) {
    try {
      // [id]/launch ile aynı yol: e-posta + backend şablonu → backend dispatch, aksi halde yerel executor
      const result = canUseBackendDispatch(campaign)
        ? await createCampaignDispatch(campaign.id)
        : await executeCampaign(campaign.id);
      results.push({ id: campaign.id, status: result.status });
    } catch (error) {
      // Gönderim başlatılamadı → 'failed' (her dakika yeniden denenmesin; panelden tekrar başlatılabilir)
      await releaseCampaign(campaign.id, 'failed').catch(() => null);
      results.push({ id: campaign.id, status: 'failed', error: error instanceof Error ? error.message : 'Bilinmeyen hata' });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
