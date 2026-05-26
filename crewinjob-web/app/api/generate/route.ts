import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { agentModule } from '@/lib/agent-bridge';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, textModel, ...params } = body;

  try {
    const api = agentModule('modules/api.js');
    const data = await api.fetchAllData();
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
        const seg = data.incomplete.segments[params.segmentIndex ?? 0];
        content = await ret.generateRetentionContent(seg, data.stats, params.language);
        break;
      }
      case 'seo_job': {
        const seoMod = agentModule('modules/seo.js');
        const job = {
          id: 1,
          title: params.jobTitle || 'Chief Officer',
          vesselType: params.vesselType || 'Bulk Carrier',
          salary: '$5,000–7,000/mo',
          location: 'Worldwide',
        };
        const result = await seoMod.generateJobSEO(job, params.language);
        // Nesneyi okunabilir Markdown formatına çevir
        if (typeof result === 'string') {
          content = result;
        } else {
          const r = result as Record<string, unknown>;
          content = [
            `## SEO Meta — ${r.jobTitle ?? job.title}`,
            '',
            `**Meta Title:** ${r.metaTitle ?? '–'}`,
            `**Meta Description:** ${r.metaDescription ?? '–'}`,
            `**Slug:** \`${r.slug ?? '–'}\``,
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
        const jobData = { stats: data.stats, jobs: [], newJobs: [] };
        const tmpDir = path.join(os.tmpdir(), 'crewinjob-kpi');
        const result = await kpi.generateWeeklyReport(jobData, tmpDir);
        content = result.analysis;
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
