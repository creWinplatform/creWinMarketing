import { NextRequest, NextResponse } from 'next/server';
import {
  getSavedAudienceStore,
  validateSavedAudience,
  type SaveAudienceInput,
} from '@/lib/saved-audiences';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type MarketingApi = {
  marketingCampaignGet: (name: string, query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingCampaignPost: (name: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function filters(value: unknown) {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    fillBuckets: Array.isArray(item.profileBuckets) ? item.profileBuckets : Array.isArray(item.fillBuckets) ? item.fillBuckets : [],
    countries: Array.isArray(item.countries) ? item.countries : [],
    nationalities: Array.isArray(item.nationalities) ? item.nationalities : [],
    positions: Array.isArray(item.positions) ? item.positions : [],
    activity: item.activity || 'all',
    reachableChannels: Array.isArray(item.channels) ? item.channels : Array.isArray(item.reachableChannels) ? item.reachableChannels : [],
  };
}

function normalizeBackend(item: Record<string, unknown>) {
  return {
    id: String(item.id),
    name: String(item.name || ''),
    description: typeof item.description === 'string' ? item.description : undefined,
    filters: filters(item.filters),
    estimatedRecipients: item.estimatedRecipients === undefined ? undefined : Number(item.estimatedRecipients),
    createdAt: String(item.creationTime || item.createdAt || ''),
    updatedAt: String(item.lastModificationTime || item.updatedAt || item.creationTime || ''),
    storage: 'backend' as const,
  };
}

export async function GET(req: NextRequest) {
  const search = (req.nextUrl.searchParams.get('search') || '').toLocaleLowerCase('tr-TR');
  const localItems = getSavedAudienceStore().list().filter(item =>
    !search || item.name.toLocaleLowerCase('tr-TR').includes(search)
  ).map(item => ({ ...item, storage: 'local' as const }));
  const api = agentModule<MarketingApi>('modules/api.js');
  try {
    const result = await api.marketingCampaignGet('GetSavedAudiences', { keyword: search, skipCount: 0, maxResultCount: 100 });
    const backendItems = (Array.isArray(result.items) ? result.items : []).map(item => normalizeBackend(item as Record<string, unknown>));
    const items = [...backendItems, ...localItems.filter(local => !backendItems.some(remote => remote.id === local.id))];
    return NextResponse.json({ items, totalCount: Number(result.totalCount ?? backendItems.length) + localItems.length, storage: 'backend', hasLocalItems: localItems.length > 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kayıtlı kitleler alınamadı.';
    if (/HTTP\s+(404|405)/i.test(message)) return NextResponse.json({ items: localItems, totalCount: localItems.length, storage: 'local', dataNote: 'Backend kayıtlı kitle servisi henüz kullanılamıyor.' });
    const status = /HTTP\s+401/i.test(message) ? 401 : /HTTP\s+403/i.test(message) ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? 'Kayıtlı kitleleri görüntülemek için yetki gerekiyor.' : 'Kayıtlı kitleler alınamadı.' }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SaveAudienceInput;
    const validationError = validateSavedAudience(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const api = agentModule<MarketingApi>('modules/api.js');
    try {
      const result = await api.marketingCampaignPost('UpsertSavedAudience', {
        id: null,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        filters: {
          profileBuckets: body.filters.fillBuckets,
          countries: body.filters.countries || [],
          nationalities: body.filters.nationalities || [],
          positions: body.filters.positions || [],
          channels: body.filters.reachableChannels || [],
          ...(body.filters.activity === 'inactive' ? { inactiveForDays: 30 } : {}),
        },
        estimatedRecipients: body.estimatedRecipients ?? null,
      });
      return NextResponse.json(normalizeBackend(result), { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kitle kaydedilemedi.';
      if (/HTTP\s+(404|405)/i.test(message)) return NextResponse.json(getSavedAudienceStore().create(body), { status: 201 });
      const status = /HTTP\s+401/i.test(message) ? 401 : /HTTP\s+403/i.test(message) ? 403 : 502;
      return NextResponse.json({ error: status === 403 ? 'Kitle kaydetmek için yetki gerekiyor.' : 'Kitle backend üzerine kaydedilemedi.' }, { status });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Kitle kaydedilemedi.' }, { status: 500 });
  }
}
