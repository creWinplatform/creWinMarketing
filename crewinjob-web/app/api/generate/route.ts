import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { agentModule } from '@/lib/agent-bridge';
import { gscConfigured, createGscClient } from '@/lib/gsc';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Process-level cache — api.js'deki cache ile aynı TTL (90 sn)
// api.js'in require cache'i atlandığında bile bu devreye girer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cachedData: any = null;
let _cacheExpiry = 0;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, textModel, ...params } = body;

  try {
    const api = agentModule('modules/api.js');
    // Process-level cache: 90 sn boyunca api.crewin.org çağrısı tekrar yapılmaz
    if (!_cachedData || Date.now() > _cacheExpiry) {
      _cachedData  = await api.fetchAllData();
      _cacheExpiry = Date.now() + 90_000;
    }
    const data = _cachedData;
    let content: string;

    switch (type) {
      case 'social': {
        const gen = agentModule('generator.js');
        if (params.customPrompt) {
          content = await gen.generateWithCustomPrompt(params.platform, params.customPrompt, data, textModel, params.language, params.tone);
        } else {
          content = await gen.generateSinglePlatform(params.platform, params.contentType, data, textModel);
        }
        break;
      }
      case 'blog': {
        const blog = agentModule('modules/blog.js');
        const topicData = params.topic
          ? { topic: params.topic, keyword: params.topic.toLowerCase(), priority: 'manual' }
          : blog.MONTHLY_BLOG_TOPICS[0];
        content = await blog.generateBlogArticle(topicData, data.stats, params.language);
        break;
      }
      case 'registration': {
        const growth = agentModule('modules/seafarer-growth.js');
        content = await growth.generateRegistrationContent(params.platform, data.stats, params.language);
        break;
      }
      case 'tiktok_cta': {
        const growth = agentModule('modules/seafarer-growth.js');
        content = await growth.generateRegistrationTikTok(params.scriptType, data.stats, params.language);
        break;
      }
      case 'retention': {
        const ret = agentModule('modules/retention.js');
        const idx = params.segmentIndex ?? 0;
        const seg = data.incomplete?.segments?.[idx];
        if (!seg) {
          return NextResponse.json({ error: 'Crewin eksik profil segmenti döndürmedi; içerik için tahmini segment üretilmedi.' }, { status: 422 });
        }
        content = await ret.generateRetentionContent(seg, data.stats, params.language);
        break;
      }
      case 'reactivation_email': {
        const ret = agentModule('modules/retention.js');
        const bucket = (params.bucket as 'zero' | 'low' | 'mid') ?? 'zero';
        const bucketCount = (data.seafarers?.fillRateBuckets?.[bucket] as number | undefined) ?? 0;
        const result = await ret.generateReactivationEmail(bucket, { count: bucketCount }, data.stats, params.language);
        return NextResponse.json(result);
      }
      case 'seo_job': {
        const seoMod = agentModule('modules/seo.js');
        // params.job: gerçek ilan seçilmişse SeoTab'dan gelen tam nesne (id, title, vesselType, company, ...)
        // Yoksa (manuel mod) rütbe/gemi tipinden hayali bir ilan kurulur — planlama amaçlı kullanılır.
        const realJob = params.job && typeof params.job === 'object'
          ? params.job as Record<string, unknown>
          : null;
        const job = realJob ?? {
          id: null,
          title: params.jobTitle || 'Chief Officer',
          vesselType: params.vesselType || 'Bulk Carrier',
          salary: '$5,000–7,000/mo',
          location: 'Worldwide',
        };
        const targetKeyword = typeof params.targetKeyword === 'string' && params.targetKeyword.trim()
          ? params.targetKeyword.trim()
          : undefined;
        const result = await seoMod.generateJobSEO(job, params.language, targetKeyword);
        // Nesneyi okunabilir Markdown formatına çevir
        if (typeof result === 'string') {
          content = result;
        } else {
          const r = result as Record<string, unknown>;
          // Gerçek ilan seçildiyse, üretilen slug yerine platformda GERÇEKTEN çalışan
          // canonical URL'i göster — /jobs/{id} 404 verir, doğrusu /jobs/detail/{id}
          const canonicalLine = job.id
            ? `**Canonical URL (gerçek, çalışan):** \`https://www.crewinjob.com/jobs/detail/${job.id}\``
            : `**Slug (öneri — henüz yayınlanmamış ilan):** \`${r.slug ?? '–'}\``;
          content = [
            `## SEO Meta — ${r.jobTitle ?? job.title}`,
            job.id ? `_Kaynak: gerçek aktif ilan (ID: ${job.id})_` : `_Kaynak: manuel şablon (henüz yayınlanmamış pozisyon)_`,
            ...(targetKeyword ? [`_🎯 Hedef keyword (Keyword Araştırma'dan): "${targetKeyword}"_`] : []),
            '',
            `**Meta Title:** ${r.metaTitle ?? '–'}`,
            `**Meta Description:** ${r.metaDescription ?? '–'}`,
            canonicalLine,
            `**Focus Keyword:** ${r.focusKeyword ?? '–'}`,
            `**Secondary Keywords:** ${Array.isArray(r.secondaryKeywords) ? (r.secondaryKeywords as string[]).join(', ') : '–'}`,
            '',
            `### Open Graph`,
            `**OG Title:** ${r.openGraphTitle ?? '–'}`,
            `**OG Description:** ${r.openGraphDescription ?? '–'}`,
            '',
            `### Schema.org`,
            `**Job Title:** ${r.schemaJobTitle ?? '–'}`,
          ].join('\n');
        }
        break;
      }
      case 'kpi': {
        const kpi = agentModule('modules/kpi.js');
        const tmpDir = path.join(os.tmpdir(), 'crewinjob-kpi');
        // GSC yapılandırılmışsa gerçek arama verisi; değilse rapor "veri yok" olarak etiketlenir (mock değil).
        // İstemci oluşturulamazsa hata nedeni kpi.js'e iletilir ve raporda görünür.
        let gscClient: { siteUrl: string; query: (b: Record<string, unknown>) => Promise<unknown> } | undefined;
        if (gscConfigured()) {
          try {
            gscClient = await createGscClient();
          } catch (e) {
            const reason = e instanceof Error ? e.message : 'GSC istemcisi oluşturulamadı';
            gscClient = { siteUrl: '', query: () => Promise.reject(new Error(reason)) };
          }
        }
        // Tam AllData gönderilir: seafarers.newThisWeek / jobs.newThisWeek gibi gerçek alanlar KPI'da kullanılır
        const result = await kpi.generateWeeklyReport(data, tmpDir, null, {
          gscClient,
          language: params.language === 'en' ? 'en' : 'tr',
          model: textModel,
        });
        content = result.analysis;
        break;
      }
      case 'kpi_compare': {
        const { reportA, reportB, language: cmpLang } = params as {
          reportA: { date: string; content: string; metadata?: Record<string, number | null> };
          reportB: { date: string; content: string; metadata?: Record<string, number | null> };
          language?: string;
        };
        const isTr = (cmpLang ?? 'tr') === 'tr';
        const ma = reportA.metadata ?? {};
        const mb = reportB.metadata ?? {};
        const hasMetrics = Object.keys(ma).length > 0 || Object.keys(mb).length > 0;

        const LABELS: Record<string, { label: string; higherIsBetter: boolean }> = {
          total:        { label: 'Toplam Seafarer',  higherIsBetter: true  },
          readyToHire:  { label: 'Activated (%80+)', higherIsBetter: true  },
          zero:         { label: '%0\'da Bekleyen',  higherIsBetter: false },
          mid:          { label: '%50–79 Dolu',       higherIsBetter: true  },
          newThisWeek:  { label: 'Bu Hafta Yeni',     higherIsBetter: true  },
          activeJobs:   { label: 'Toplam İlan',       higherIsBetter: true  },
          companies:    { label: 'Toplam Şirket',     higherIsBetter: true  },
          newCompanies: { label: 'Yeni Şirket',       higherIsBetter: true  },
        };

        let metricsBlock = '';
        if (hasMetrics) {
          const rows = Object.entries(LABELS).map(([key, def]) => {
            const va = ma[key], vb = mb[key];
            if (va == null || vb == null) return null;
            const d = (vb as number) - (va as number);
            const sign = d > 0 ? '+' : '';
            const trend = d === 0 ? '→' : def.higherIsBetter === (d > 0) ? '✓ iyileşme' : '✗ kötüleşme';
            return `- ${def.label}: ${va} → ${vb} (${sign}${d}) [${trend}]`;
          }).filter(Boolean).join('\n');
          metricsBlock = `Metrik değişimleri (A=eski ${reportA.date}, B=yeni ${reportB.date}):\n${rows}`;
        }

        const prompt = `Sen bir denizcilik sektörü büyüme analistisin. CrewinJob platformunun iki haftalık KPI raporu arasındaki farkları değerlendiriyorsun.

${metricsBlock}

--- A RAPORU (${reportA.date}) ---
${reportA.content.slice(0, 1200)}

--- B RAPORU (${reportB.date}) ---
${reportB.content.slice(0, 1200)}

${isTr ? `Lütfen şunları ${isTr ? 'Türkçe' : 'English'} olarak analiz et:
1. **Genel Trend** — Platform büyüme mü, küçülme mü? En önemli 2-3 sinyal nedir?
2. **Kritik Bulgular** — Dikkat çeken pozitif ve negatif değişimler (sayısal verilerle destekle).
3. **Öncelikli Aksiyonlar** — Bu hafta yapılması gereken en önemli 3 pazarlama/aktivasyon adımı nedir? Somut ve uygulanabilir ol.
4. **Eğilim Tahmini** — Bu tempo devam ederse önümüzdeki hafta ne beklenmeli?

Kısa, özlü ve aksiyon odaklı yaz. Bullet point kullan.` : `Please analyze in English:
1. **Overall Trend** — Is the platform growing or shrinking? What are the top 2-3 signals?
2. **Critical Findings** — Notable positive and negative changes (back with numbers).
3. **Priority Actions** — Top 3 marketing/activation steps for this week. Be concrete and actionable.
4. **Trend Forecast** — If this pace continues, what to expect next week?

Be concise and action-focused. Use bullet points.`}`;

        const client = agentModule('ai-client.js');
        const res = await client.messages.create({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: prompt }] });
        content = res.content[0].text;
        break;
      }
      case 'facebook_ads': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateFacebookCampaign(params, data, textModel);
        break;
      }
      case 'google_ads': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateGoogleCampaign(params, data, textModel);
        break;
      }
      case 'instagram_ads': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateInstagramCampaign(params, data, textModel);
        break;
      }
      case 'linkedin_ads': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateLinkedInCampaign(params, data, textModel);
        break;
      }
      case 'keyword_research': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateKeywordResearch(params, data, textModel);
        break;
      }
      case 'competitor_analysis': {
        const ads = agentModule('modules/ads.js');
        content = await ads.generateCompetitorAnalysis(params, data, textModel);
        break;
      }
      case 'click_to_whatsapp': {
        const msg = agentModule('modules/messaging.js');
        content = await msg.generateClickToWhatsApp(params, data, textModel);
        break;
      }
      case 'telegram_channel': {
        const msg = agentModule('modules/messaging.js');
        content = await msg.generateTelegramChannel(params, data, textModel);
        break;
      }
      case 'telegram_bot': {
        const msg = agentModule('modules/messaging.js');
        content = await msg.generateTelegramBot(params, data, textModel);
        break;
      }
      case 'ab_test': {
        // 3 farklı tonu paralelde üret — hızlı A/B karşılaştırması
        const gen = agentModule('generator.js');
        const TONES = [
          { tone: 'professional', label: '🎯 Profesyonel & Otoriter' },
          { tone: 'emotional',    label: '❤️ Duygusal & İlham Verici' },
          { tone: 'casual',       label: '😊 Samimi & Konuşma Dili' },
        ];
        const variants = await Promise.all(
          TONES.map(t =>
            gen.generateWithCustomPrompt(
              params.platform,
              params.customPrompt || `${params.platform} için ${params.contentType || 'tanıtım'} içeriği üret`,
              data,
              textModel,
              params.language || 'tr',
              t.tone,
            ).then((c: string) => ({ label: t.label, tone: t.tone, content: c }))
          )
        );
        return NextResponse.json({ variants });
      }

      default:
        return NextResponse.json({ error: `Bilinmeyen tip: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
