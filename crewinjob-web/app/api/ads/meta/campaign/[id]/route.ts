/**
 * PATCH  /api/ads/meta/campaign/[id]   — Update campaign (name, status, budget)
 * DELETE /api/ads/meta/campaign/[id]   — Archive campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  META_ID_RE, badRequest, errorMessage, isConfigured, metaFetch, notConfiguredResponse, readJsonBody, unknownKeys,
} from '../../../_lib/platforms';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Sistem token'ı ile graph/{id}'ye yalnızca bu alanlar iletilir (eskiden gövdedeki her anahtar geçiyordu)
const ALLOWED_KEYS = ['name', 'status', 'daily_budget', 'lifetime_budget'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('meta')) return notConfiguredResponse('meta');
  const id = String(params.id || '');
  if (!META_ID_RE.test(id)) return badRequest('Geçersiz Meta kampanya ID.');

  const patch = await readJsonBody(req);
  if (!patch) return badRequest('Geçersiz JSON gövdesi.');
  const extra = unknownKeys(patch, ALLOWED_KEYS);
  if (extra.length) return badRequest(`İzin verilmeyen alan(lar): ${extra.join(', ')}`);

  const body = new URLSearchParams();
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name || name.length > 200) return badRequest('name 1-200 karakter olmalı.');
    body.set('name', name);
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'ACTIVE' && patch.status !== 'PAUSED') return badRequest('status yalnızca ACTIVE veya PAUSED olabilir.');
    body.set('status', patch.status);
  }
  // Bütçeler Meta'nın beklediği gibi para biriminin en küçük biriminde (ör. cent), pozitif tam sayı.
  // Not: kampanya düzeyi bütçe yalnızca CBO kampanyalarda geçerlidir; değilse Meta hatası iletilir.
  for (const key of ['daily_budget', 'lifetime_budget'] as const) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e12) return badRequest(`${key} pozitif bir sayı olmalı.`);
    body.set(key, String(Math.round(value)));
  }
  if (!body.toString()) return badRequest('Güncellenecek alan yok.');

  try {
    await metaFetch(id, { method: 'POST', body });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isConfigured('meta')) return notConfiguredResponse('meta');
  const id = String(params.id || '');
  if (!META_ID_RE.test(id)) return badRequest('Geçersiz Meta kampanya ID.');

  try {
    // Kalıcı silme yerine arşivleme (geri alınabilir)
    await metaFetch(id, { method: 'POST', body: new URLSearchParams({ status: 'ARCHIVED' }) });
    return NextResponse.json({ success: true, archived: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 502 });
  }
}
