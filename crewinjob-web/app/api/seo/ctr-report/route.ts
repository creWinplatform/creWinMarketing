import { NextRequest, NextResponse } from 'next/server';
import { gscConfigured, createGscClient, dateRangeForDays, googleErrorStatus, type GscQueryRow } from '@/lib/gsc';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// GSC'nin genel organik pozisyon bazlı ortalama CTR eğrisi (branded olmayan, sektör bağımsız).
// Kaynak: birden çok yayınlanmış CTR-by-position çalışmasının ortalaması — kesin değil,
// ama "bu pozisyonda normalde ne kadar tıklanır" için makul bir referans çizgisi sağlar.
const EXPECTED_CTR_CURVE: [number, number][] = [
  [1, 0.28], [2, 0.15], [3, 0.11], [4, 0.08], [5, 0.07],
  [6, 0.05], [7, 0.04], [8, 0.03], [9, 0.03], [10, 0.02],
  [15, 0.012], [20, 0.008], [50, 0.003],
];

function expectedCtrForPosition(position: number): number {
  for (const [pos, ctr] of EXPECTED_CTR_CURVE) {
    if (position <= pos) return ctr;
  }
  return 0.002;
}

interface CtrRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  expectedCtr: number;
  lostClicks: number;
}

interface Suggestion {
  page: string;
  suggestedTitle: string;
  suggestedDescription: string;
  reasoning: string;
}

// Minimum gösterim eşiği — istatistiksel gürültüyü ele (tek haneli gösterimli
// sorgular CTR hesaplamasında anlamsız dalgalanma yaratır).
const MIN_IMPRESSIONS = 15;
// Bir satırın "düşük CTR" sayılması için beklenen CTR'ın en fazla bu oranı kadar
// gerçekleşmiş olması gerekir (ör. 0.5 → beklenenin yarısından azsa flag'lenir).
const UNDERPERFORM_RATIO = 0.55;
const MAX_AI_ROWS = 15;

export async function GET(req: NextRequest) {
  if (!gscConfigured()) {
    return NextResponse.json({ ok: false, notConfigured: true });
  }

  const rangeParam = req.nextUrl.searchParams.get('range') || '30';
  const days       = ['7', '30', '90'].includes(rangeParam) ? parseInt(rangeParam) : 30;
  const language   = req.nextUrl.searchParams.get('lang') === 'en' ? 'en' : 'tr';
  const withAi     = req.nextUrl.searchParams.get('ai') !== '0';

  try {
    const gsc  = await createGscClient();
    const range = dateRangeForDays(days);

    // query+page birleşik boyut — hangi sayfanın hangi sorgu için düşük CTR'lı olduğunu gösterir
    const res = await gsc.query({
      ...range,
      dimensions: ['query', 'page'],
      rowLimit: 500,
    });

    const rawRows: GscQueryRow[] = res.rows || [];

    const analyzed: CtrRow[] = rawRows
      .filter(r => r.impressions >= MIN_IMPRESSIONS && r.keys && r.keys.length === 2)
      .map(r => {
        const expectedCtr = expectedCtrForPosition(r.position);
        return {
          query:       r.keys![0],
          page:        r.keys![1],
          clicks:      r.clicks,
          impressions: r.impressions,
          ctr:         r.ctr,
          position:    r.position,
          expectedCtr,
          lostClicks:  Math.max(0, r.impressions * (expectedCtr - r.ctr)),
        };
      })
      .filter(r => r.ctr < r.expectedCtr * UNDERPERFORM_RATIO)
      .sort((a, b) => b.lostClicks - a.lostClicks);

    const topRows = analyzed.slice(0, MAX_AI_ROWS);

    let suggestions: Suggestion[] = [];
    if (withAi && topRows.length > 0) {
      try {
        const seoMod = agentModule<{
          generateCtrFixSuggestions: (rows: CtrRow[], lang: string) => Promise<Suggestion[]>;
        }>('modules/seo.js');
        suggestions = await seoMod.generateCtrFixSuggestions(topRows, language);
      } catch (e: unknown) {
        // AI önerisi başarısız olsa da ham analiz verisi değerli — hatayı yutma, ama bloklama
        return NextResponse.json({
          ok: true,
          rows: topRows,
          suggestions: [],
          aiError: (e as Error).message,
          totalAnalyzed: analyzed.length,
          source: 'google_search_console',
          period: { ...range, days },
          prioritization: 'position_based_expected_ctr_heuristic',
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      rows: topRows,
      suggestions,
      totalAnalyzed: analyzed.length,
      source: 'google_search_console',
      period: { ...range, days },
      prioritization: 'position_based_expected_ctr_heuristic',
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    // Google hatası artık sessizce boş veri olarak dönmez: {ok:false} + uygun HTTP durumu
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Search Console verisi alınamadı' }, { status: googleErrorStatus(e) });
  }
}
