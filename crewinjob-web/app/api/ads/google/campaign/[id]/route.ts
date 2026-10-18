/**
 * PATCH  /api/ads/google/campaign/[id]   — Update Google campaign (name, status, daily budget)
 * DELETE /api/ads/google/campaign/[id]   — Pause campaign; ?confirm=remove ile KALICI olarak kaldırır
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_ID_RE, badRequest, errorMessage, googleAdsPost, googleCustomerId, isConfigured,
  notConfiguredResponse, readJsonBody, unknownKeys,
} from '../../../_lib/platforms';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const ALLOWED_KEYS = ['name', 'status', 'budgetDaily'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('google')) return notConfiguredResponse('google');
  const id = String(params.id || '');
  if (!GOOGLE_ID_RE.test(id)) return badRequest('Geçersiz Google kampanya ID.');

  const patch = await readJsonBody(req);
  if (!patch) return badRequest('Geçersiz JSON gövdesi.');
  const extra = unknownKeys(patch, ALLOWED_KEYS);
  if (extra.length) return badRequest(`İzin verilmeyen alan(lar): ${extra.join(', ')}`);

  const update: Record<string, string> = {};
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name || name.length > 200) return badRequest('name 1-200 karakter olmalı.');
    update.name = name;
  }
  if (patch.status !== undefined) {
    // REMOVED yalnızca DELETE + açık onay ile (geri alınamaz)
    if (patch.status !== 'ACTIVE' && patch.status !== 'PAUSED') return badRequest('status yalnızca ACTIVE veya PAUSED olabilir.');
    update.status = patch.status === 'ACTIVE' ? 'ENABLED' : 'PAUSED';
  }
  let budgetDaily: number | null = null;
  if (patch.budgetDaily !== undefined) {
    if (typeof patch.budgetDaily !== 'number' || !Number.isFinite(patch.budgetDaily) || patch.budgetDaily <= 0 || patch.budgetDaily > 1_000_000) {
      return badRequest('budgetDaily pozitif bir sayı olmalı.');
    }
    budgetDaily = patch.budgetDaily;
  }
  if (!Object.keys(update).length && budgetDaily === null) return badRequest('Güncellenecek alan yok.');

  try {
    const customer = googleCustomerId();

    // Bütçe kampanyada değil, bağlı campaign_budget kaynağında → önce o güncellenir
    if (budgetDaily !== null) {
      const found = await googleAdsPost<{ results?: Array<{ campaign?: { campaignBudget?: string }; campaignBudget?: { explicitlyShared?: boolean } }> }>(
        'googleAds:search',
        { query: `SELECT campaign.campaign_budget, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${id}` },
      );
      const row = found.results?.[0];
      const budgetResource = row?.campaign?.campaignBudget;
      if (!budgetResource) throw new Error('Kampanya veya bağlı bütçe bulunamadı.');
      if (row?.campaignBudget?.explicitlyShared) {
        return NextResponse.json({ success: false, error: 'Bu kampanya paylaşılan bir bütçe kullanıyor; değişiklik diğer kampanyaları da etkiler. Google Ads arayüzünden güncelleyin.' }, { status: 409 });
      }
      await googleAdsPost('campaignBudgets:mutate', {
        operations: [{
          updateMask: 'amountMicros',
          update: { resourceName: budgetResource, amountMicros: String(Math.round(budgetDaily * 100) * 10_000) },
        }],
      });
    }

    if (Object.keys(update).length) {
      await googleAdsPost('campaigns:mutate', {
        operations: [{
          updateMask: Object.keys(update).join(','),
          update: { resourceName: `customers/${customer}/campaigns/${id}`, ...update },
        }],
      });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('google')) return notConfiguredResponse('google');
  const id = String(params.id || '');
  if (!GOOGLE_ID_RE.test(id)) return badRequest('Geçersiz Google kampanya ID.');

  // Google'da "remove" kalıcıdır (REMOVED geri alınamaz). Açık onay yoksa yalnızca duraklatılır.
  const confirmRemove = req.nextUrl.searchParams.get('confirm') === 'remove';

  try {
    const customer = googleCustomerId();
    const resourceName = `customers/${customer}/campaigns/${id}`;
    await googleAdsPost('campaigns:mutate', {
      operations: [confirmRemove
        ? { remove: resourceName }
        : { updateMask: 'status', update: { resourceName, status: 'PAUSED' } }],
    });
    return NextResponse.json({ success: true, removed: confirmRemove, paused: !confirmRemove });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}
