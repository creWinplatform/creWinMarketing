import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { audienceSegmentFilters, type FillBucket } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type DistributionItem = Record<string, unknown>;
type PreviewResult = {
  estimatedRecipients?: number;
  exactCount?: boolean | number;
  profileCompletionDistribution?: DistributionItem[];
  countryDistribution?: DistributionItem[];
  nationalityDistribution?: DistributionItem[];
  positionDistribution?: DistributionItem[];
  activityDistribution?: { active?: number; inactive?: number; unknown?: number };
  channelReachability?: { email?: number; whatsapp?: number; telegram?: number; push?: number };
};

function rows(values: DistributionItem[] | undefined, fallback: string) {
  return (values || []).map((item, index) => ({
    name: String(item.name ?? item.label ?? item.countryName ?? item.countryCode ?? item.nationality ?? item.position ?? item.bucket ?? item.key ?? item.code ?? `${fallback} ${index + 1}`),
    count: Number(item.count ?? item.value ?? item.total ?? 0),
  })).filter(item => item.count > 0).slice(0, 8);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    fillBuckets?: FillBucket[];
    audienceType?: 'seafarers' | 'maritime_businesses' | 'company_prospects';
    manualEmails?: string[];
    countries?: string[];
    nationalities?: string[];
    positions?: string[];
    activity?: 'all' | 'active' | 'inactive';
    reachableChannels?: string[];
  };
  const manualCount = new Set((body.manualEmails || []).map(item => item.trim().toLowerCase()).filter(Boolean)).size;
  if (body.audienceType === 'maritime_businesses' || body.audienceType === 'company_prospects') {
    return NextResponse.json({
      bucketCount: 0,
      manualCount,
      estimatedTotal: manualCount,
      isEstimate: false,
      distributions: null,
    });
  }
  const api = agentModule<{ growthAnalyticsPost: (name: string, body: Record<string, unknown>) => Promise<PreviewResult> }>('modules/api.js');
  try {
    // Gönderimde (Dispatch / GetCampaignRecipients / backend snapshot) kullanılan filtrelerin aynısı
    const result = await api.growthAnalyticsPost('PreviewAudience', {
      profileBuckets: body.fillBuckets || [],
      ...audienceSegmentFilters(body),
      channels: body.reachableChannels || [],
    });
    const backendCount = typeof result.exactCount === 'number'
      ? result.exactCount
      : Number(result.estimatedRecipients || 0);
    const activity = result.activityDistribution || {};
    return NextResponse.json({
      bucketCount: backendCount,
      manualCount,
      estimatedTotal: backendCount + manualCount,
      isEstimate: typeof result.exactCount === 'number' ? false : result.exactCount !== true,
      distributions: {
        profileCompletion: rows(result.profileCompletionDistribution, 'Profil'),
        countries: rows(result.countryDistribution, 'Ülke'),
        nationalities: rows(result.nationalityDistribution, 'Uyruk'),
        positions: rows(result.positionDistribution, 'Pozisyon'),
        activity: {
          active: Number(activity.active || 0),
          inactive: Number(activity.inactive || 0),
          unknown: Number(activity.unknown || 0),
        },
        channelReachability: {
          email: Number(result.channelReachability?.email || 0),
          whatsapp: Number(result.channelReachability?.whatsapp || 0),
          telegram: Number(result.channelReachability?.telegram || 0),
          push: Number(result.channelReachability?.push || 0),
        },
        source: 'aggregate',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Hedef kitle hesaplanamadı.' }, { status: 502 });
  }
}
