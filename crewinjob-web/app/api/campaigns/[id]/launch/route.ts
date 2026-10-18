import { NextRequest, NextResponse } from 'next/server';
import { executeCampaign } from '@/lib/campaign-executor';
import { canUseBackendDispatch, createCampaignDispatch } from '@/lib/campaign-dispatch';
import { claimCampaign, getCampaign, isRemoteOnlyCampaignId, releaseCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// "Şimdi başlat" ile çalıştırılabilen durumlar (failed/partial = başarısızları tekrar dene)
const LAUNCHABLE = ['draft', 'ready', 'scheduled', 'partial', 'failed'] as const;

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isRemoteOnlyCampaignId(params.id)) {
    return NextResponse.json({ error: 'Bu kampanya yalnızca backend\'de kayıtlı; başlatma/düzenleme backend yönetiminden yapılmalı. / This campaign exists only in the backend; manage it there.', code: 'remote_only' }, { status: 409 });
  }
  const current = getCampaign(params.id);
  if (!current) return NextResponse.json({ error: 'Kampanya bulunamadı.' }, { status: 404 });

  // Atomik claim: çakışan cron (run-due) veya çift tıklama aynı kampanyayı ikinci kez gönderemez
  const claim = await claimCampaign(params.id, [...LAUNCHABLE]);
  if (!claim) {
    return NextResponse.json({ error: current.status === 'running' ? 'Kampanya zaten çalışıyor.' : 'Kampanya bu durumda başlatılamaz.', code: 'not_launchable' }, { status: 409 });
  }
  try {
    const campaign = canUseBackendDispatch(claim.campaign)
      ? await createCampaignDispatch(params.id)
      : await executeCampaign(params.id);
    return NextResponse.json(campaign);
  } catch (error) {
    // Gönderim başlamadan hata → önceki duruma dön (kullanıcı düzeltip tekrar deneyebilsin)
    await releaseCampaign(params.id, claim.previousStatus).catch(() => null);
    const message = error instanceof Error ? error.message : 'Kampanya çalıştırılamadı.';
    const code = (error as { code?: string }).code;
    return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: message.includes('bulunamadı') ? 404 : 409 });
  }
}
