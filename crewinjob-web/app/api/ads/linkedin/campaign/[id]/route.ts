/**
 * PATCH  /api/ads/linkedin/campaign/[id]   — Update campaign (name, status, budget)
 * DELETE /api/ads/linkedin/campaign/[id]   — Archive campaign
 *
 * Versiyonlu REST API: POST /rest/adAccounts/{accountId}/adCampaigns/{id} + X-RestLi-Method: PARTIAL_UPDATE
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  badRequest, errorMessage, isConfigured, linkedinAccountCurrency, linkedinAccountId, linkedinCampaignId,
  linkedinFetch, notConfiguredResponse, readJsonBody, unknownKeys,
} from '../../../_lib/platforms';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// $set'e yalnızca bu alanlar girer (eskiden gövdedeki her anahtar LinkedIn'e iletiliyordu)
const ALLOWED_KEYS = ['name', 'status', 'dailyBudget', 'totalBudget'] as const;

async function partialUpdate(campaignId: string, set: Record<string, unknown>) {
  const act = linkedinAccountId();
  await linkedinFetch(`/adAccounts/${act}/adCampaigns/${campaignId}`, {
    method:  'POST',
    headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' },
    body:    JSON.stringify({ patch: { $set: set } }),
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('linkedin')) return notConfiguredResponse('linkedin');
  const id = linkedinCampaignId(params.id);
  if (!id) return badRequest('Geçersiz LinkedIn kampanya ID (sayı veya urn:li:sponsoredCampaign:<id>).');

  const patch = await readJsonBody(req);
  if (!patch) return badRequest('Geçersiz JSON gövdesi.');
  const extra = unknownKeys(patch, ALLOWED_KEYS);
  if (extra.length) return badRequest(`İzin verilmeyen alan(lar): ${extra.join(', ')}`);

  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name || name.length > 200) return badRequest('name 1-200 karakter olmalı.');
    set.name = name;
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'ACTIVE' && patch.status !== 'PAUSED') return badRequest('status yalnızca ACTIVE veya PAUSED olabilir.');
    set.status = patch.status;
  }

  try {
    // Bütçeler hesap para biriminde ana birim (sayı) olarak alınır → LinkedIn para nesnesine çevrilir
    for (const key of ['dailyBudget', 'totalBudget'] as const) {
      if (patch[key] === undefined) continue;
      const value = patch[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return badRequest(`${key} pozitif bir sayı olmalı.`);
      set[key] = { amount: value.toFixed(2), currencyCode: await linkedinAccountCurrency() };
    }
    if (!Object.keys(set).length) return badRequest('Güncellenecek alan yok.');

    await partialUpdate(id, set);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('linkedin')) return notConfiguredResponse('linkedin');
  const id = linkedinCampaignId(params.id);
  if (!id) return badRequest('Geçersiz LinkedIn kampanya ID (sayı veya urn:li:sponsoredCampaign:<id>).');

  try {
    // Kalıcı silme yalnızca DRAFT kampanyalarda mümkün; arşivleme her durumda güvenli
    await partialUpdate(id, { status: 'ARCHIVED' });
    return NextResponse.json({ success: true, archived: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}
