import type { Db } from '../db/client';
import 'server-only';
import { fetchPublic } from '../site-audit';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ProjectOperations } from './operations';
import { ryzevoFeature } from './ryzevo-features';
import { recordAiUsage } from './coach-ai';

// Pictures for the design studio, besides the person's own photos:
// - Stock: Openverse (WordPress's open image search), only CC0 and public-domain works, so they can be used
//   commercially without attribution. Images come through Openverse's own image proxy and then through this server,
//   so the browser never contacts a third party and the canvas stays exportable.
// - AI: one image from the project's Gemini key, counted against the plan's AI quota (refunded on failure). The model
//   is told to leave out text, logos and real people's likenesses; the design studio adds the words itself.
export type StockImage = { id: string; title: string; creator: string; license: string; source: string; landing: string; width: number; height: number; thumb: string };
export type DesignPicture = { data: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; credit: string };
const OPENVERSE = 'https://api.openverse.org/v1';
const STOCK_PER_DAY = 200;
const MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
// Openverse's thumbnail proxy answers 406 to most Accept lists (even image/*); */* always works and the bytes are
// checked for JPEG, PNG or WebP here anyway.
const IMAGE_ACCEPT = '*/*';
const args = (scope: MarketingScope) => [scope.organizationId, scope.projectId] as const;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function authorize(db: Db, scope: MarketingScope) {
  const repo = new PlatformRepository(db), workspace = await repo.workspace(scope.subject, ...args(scope)), pack = workspace?.project.productPack;
  if (!workspace || !(pack === 'standard' || ryzevoFeature(pack, 'brand'))) throw new MarketingStoreError('Görsel kaynakları için proje erişimi gerekli.', 403);
  if (!await repo.can(scope.subject, ...args(scope), 'content.write')) throw new MarketingStoreError('Görsel aramak veya üretmek için içerik yazma yetkisi gerekir.', 403);
}
// A daily counter per project in platform_usage (resource "stock_search"); refused past the limit.
async function countStock(db: Db, scope: MarketingScope) {
  const period = new Date().toISOString().slice(0, 10);
  const row = await db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='stock_search'").get(...args(scope), period) as { count: number } | undefined;
  if (Number(row?.count || 0) >= STOCK_PER_DAY) throw new MarketingStoreError('Bugünkü stok görsel arama sınırına ulaşıldı. Yarın tekrar deneyin.', 429);
  await db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'stock_search',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...args(scope), period);
}
async function readBytes(response: Response, max: number) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await response.body?.cancel().catch(() => undefined); throw new Error('too_large'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('no_body');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel().catch(() => undefined); throw new Error('too_large'); } parts.push(value); }
  return Buffer.concat(parts);
}
function imageMime(bytes: Buffer): DesignPicture['mime'] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
type Fetcher = (url: URL, accept: string) => Promise<Response>;
const publicFetch: Fetcher = async (url, accept) => (await fetchPublic(url, accept)).response;

export async function searchStock(db: Db, scope: MarketingScope, raw: Record<string, unknown>, fetcher: Fetcher = publicFetch): Promise<StockImage[]> {
  await authorize(db, scope);
  const query = text(raw.query, 80);
  if (query.length < 2) throw new MarketingStoreError('Aramak için en az 2 harf yazın.');
  await countStock(db, scope);
  let results: Record<string, unknown>[];
  try {
    const response = await fetcher(new URL(`${OPENVERSE}/images/?${new URLSearchParams({ q: query, license: 'cc0,pdm', page_size: '20', mature: 'false' })}`), 'application/json');
    if (response.status !== 200) throw new Error();
    results = (JSON.parse((await readBytes(response, 2_000_000)).toString('utf8')).results || []) as Record<string, unknown>[];
  } catch { throw new MarketingStoreError('Stok görsel araması şu anda yapılamadı. Biraz sonra tekrar deneyin.', 502); }
  const items = results.filter(item => typeof item.id === 'string' && /^[a-f0-9-]{36}$/.test(item.id as string)).slice(0, 20);
  // Thumbnails come through this server as small data, six at a time; some sources have gone away, so 20 (the most an
  // anonymous Openverse request returns) are asked for and the first 18 that load are kept.
  const out: StockImage[] = [];
  for (let i = 0; i < items.length && out.length < 18; i += 6) {
    out.push(...(await Promise.all(items.slice(i, i + 6).map(async item => {
      try {
        const response = await fetcher(new URL(`${OPENVERSE}/images/${item.id}/thumb/`), IMAGE_ACCEPT);
        if (response.status !== 200) return null;
        const bytes = await readBytes(response, 400_000), mime = imageMime(bytes);
        if (!mime) return null;
        return { id: item.id as string, title: text(item.title, 120), creator: text(item.creator, 80), license: text(item.license, 20).toUpperCase(), source: text(item.source, 40), landing: /^https:\/\//.test(String(item.foreign_landing_url)) ? String(item.foreign_landing_url).slice(0, 300) : '', width: Number(item.width) || 0, height: Number(item.height) || 0, thumb: `data:${mime};base64,${bytes.toString('base64')}` };
      } catch { return null; }
    }))).filter((item): item is StockImage => Boolean(item)));
  }
  return out.slice(0, 18);
}

// The chosen stock image at full size (Openverse's proxy, at most 8 MB), re-checked to be CC0 or public domain.
export async function stockPicture(db: Db, scope: MarketingScope, raw: Record<string, unknown>, fetcher: Fetcher = publicFetch): Promise<DesignPicture> {
  await authorize(db, scope);
  if (typeof raw.id !== 'string' || !/^[a-f0-9-]{36}$/.test(raw.id)) throw new MarketingStoreError('Geçersiz stok görsel.');
  try {
    const meta = await fetcher(new URL(`${OPENVERSE}/images/${raw.id}/`), 'application/json');
    if (meta.status !== 200) throw new Error();
    const info = JSON.parse((await readBytes(meta, 200_000)).toString('utf8')) as Record<string, unknown>;
    if (!['cc0', 'pdm'].includes(String(info.license))) throw new MarketingStoreError('Bu görsel ticari kullanım için serbest değil.', 409);
    const response = await fetcher(new URL(`${OPENVERSE}/images/${raw.id}/thumb/?full_size=true&compressed=false`), IMAGE_ACCEPT);
    if (response.status !== 200) throw new Error();
    const bytes = await readBytes(response, 8_000_000), mime = imageMime(bytes);
    if (!mime) throw new Error();
    return { data: bytes.toString('base64'), mime, credit: `${text(info.title, 80) || 'Openverse'}${info.creator ? ` · ${text(info.creator, 60)}` : ''} · ${String(info.license).toUpperCase()} · Openverse` };
  } catch (error) {
    if (error instanceof MarketingStoreError) throw error;
    throw new MarketingStoreError('Görsel indirilemedi. Başka bir görsel seçin.', 502);
  }
}

// `source`: a product photo the person took; the model places that product in a new scene instead of inventing one.
export type ImageGenerator = (prompt: string, aspect: string, source?: { data: string; mime: string }) => Promise<{ data: string; mime: string; usage?: { provider: string; model: string; prompt: number; output: number; thinking: number; total: number } | null }>;
const ASPECTS = ['1:1', '4:5', '9:16', '16:9', '3:4'] as const;
// One AI image under an AI-quota reservation, completed with the result or refunded on any failure.
export async function aiPicture(db: Db, scope: MarketingScope, raw: Record<string, unknown>, generator?: ImageGenerator): Promise<DesignPicture> {
  await authorize(db, scope);
  if (!generator) throw new MarketingStoreError('Bu platform için AI görsel modeli yapılandırılmadı.', 503);
  const subject = text(raw.prompt, 300), aspect = ASPECTS.includes(raw.aspect as typeof ASPECTS[number]) ? raw.aspect as string : '1:1';
  if (subject.length < 4) throw new MarketingStoreError('Görselde ne olacağını kısaca yazın (en az 4 harf).');
  // A product photo (at most 6 MB, JPEG/PNG/WebP by its bytes) turns the request into a product shot.
  let source: { data: string; mime: string } | undefined;
  if (raw.source !== undefined && raw.source !== null) {
    const value = raw.source as Record<string, unknown>, bytes = typeof value?.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.data) ? Buffer.from(value.data, 'base64') : Buffer.alloc(0), mime = imageMime(bytes);
    if (!mime || bytes.length > 6_000_000) throw new MarketingStoreError('Ürün fotoğrafı en fazla 6 MB JPEG, PNG veya WebP olmalı.');
    source = { data: bytes.toString('base64'), mime };
  }
  const prompt = source
    ? `Create a realistic, high-quality marketing photograph that shows the exact product from the attached photo in this scene: ${subject}. Keep the product's shape, colours, labels and proportions exactly as in the photo; change only the background, surface and lighting. Composition ${aspect}, with calm empty space where a headline can be placed. Do not add any other text, logos, watermarks or recognisable real people.`
    : `A high-quality, realistic marketing photograph for social media. Subject: ${subject}. Composition ${aspect}, with calm empty space where a headline can be placed. Do not include any text, letters, numbers, logos, watermarks, brand marks or recognisable real people.`;
  const operations = new ProjectOperations(db, scope), reservation = await operations.reserveAi();
  let done = false;
  try {
    const result = await generator(prompt, aspect, source), bytes = Buffer.from(result.data, 'base64'), mime = imageMime(bytes);
    if (!mime || bytes.length > 12_000_000) throw new Error('bad_image');
    await db.transaction(async () => { await operations.completeAi(reservation); if (result.usage) await recordAiUsage(db, scope, reservation, result.usage); });
    done = true;
    return { data: bytes.toString('base64'), mime, credit: source ? 'AI · Gemini (ürün fotoğrafından)' : 'AI · Gemini' };
  } catch (error) {
    if (!done) { try { await operations.refundAi(reservation); } catch { console.error('platform_usage_release_failed'); } }
    if (!(error instanceof MarketingStoreError)) console.error('platform_design_ai_failed', JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: String(error instanceof Error ? error.message : error).replace(/([?&]key=)[^&\s"']+/gi, '$1…').replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza…').slice(0, 300) }));
    throw error instanceof MarketingStoreError ? error : new MarketingStoreError('AI görsel üretilemedi. Biraz sonra tekrar deneyin veya stok görsel kullanın.', 502);
  }
}
// Gemini image models in order; the first that answers with an image wins.
export function geminiImageGenerator(): ImageGenerator | undefined {
  const key = process.env.PLATFORM_GEMINI_API_KEY;
  if (!key) return undefined;
  const models = [process.env.PLATFORM_GEMINI_IMAGE_MODEL, 'gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
  return async (prompt, aspect, source) => {
    let last: unknown = null;
    for (const model of models) {
      for (const imageConfig of [{ aspectRatio: aspect }, undefined]) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ contents: [{ parts: [...(source ? [{ inlineData: { mimeType: source.mime, data: source.data } }] : []), { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(imageConfig ? { imageConfig } : {}) } }) });
          if (!response.ok) { last = new Error(`${model} ${response.status}`); if (response.status === 400 && imageConfig) continue; break; }
          const value = await response.json() as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number } };
          const part = value.candidates?.[0]?.content?.parts?.find(item => item.inlineData)?.inlineData;
          if (!part) { last = new Error(`${model} no_image`); break; }
          const meta = value.usageMetadata;
          return { data: part.data, mime: part.mimeType, usage: meta ? { provider: 'gemini', model, prompt: meta.promptTokenCount ?? 0, output: meta.candidatesTokenCount ?? 0, thinking: meta.thoughtsTokenCount ?? 0, total: meta.totalTokenCount ?? 0 } : null };
        } catch (error) { last = error; break; }
      }
    }
    throw last instanceof Error ? last : new Error('no_model');
  };
}
