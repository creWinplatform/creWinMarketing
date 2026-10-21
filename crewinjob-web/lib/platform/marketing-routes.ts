import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdentity } from '@/lib/auth';
import { buildCampaign, type CreateCampaignInput, type UnifiedCampaign } from '@/lib/campaigns';
import type { HistoryItem } from '@/lib/content-history';
import { getPlatformAccess } from './workspace-server';
import { platformDatabase } from './database';
import { ProjectMarketingStore, MarketingStoreError } from './marketing-store';
import { hasSameRequestOrigin } from './request-origin';
import { credentialEncryptionKey } from './credential-key';
import { ConnectionJobs } from './connection-jobs';
import { ProductSegments } from './segments';
import type {SegmentBinding} from './segment-types';
import type { SmtpConfiguration } from './email-configuration';
import type { SocialConfiguration } from './social-configuration';
import { normalizePublicationImage } from './publication-image';
import { readBoundedJsonBytes } from './request-json';
import { COACH_REF } from './coach-types';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, maximum: number, fallback = '') => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > maximum) throw new MarketingStoreError('Alan türü veya uzunluğu geçersiz.');
  return value;
};

function campaignInput(raw: Record<string, unknown>, timezone: string, goalIds: string[]): CreateCampaignInput {
  if (raw.status !== undefined && raw.status !== 'draft') throw new MarketingStoreError('Bu proje için yalnız taslak kaydedilebilir.', 409);
  if (raw.launchAt) throw new MarketingStoreError('Zamanlanmış gönderim bağlantı doğrulamasından sonra açılacak.', 409);
  const name = string(raw.name, 160).trim();
  const content = object(raw.content), channels = object(raw.channels);
  const text = string(content.text, 100000).trim();
  if (!name || !text) throw new MarketingStoreError('Kampanya adı ve içerik gerekli.');
  const objective = string(raw.objective, 50, 'awareness');
  const goalId = string(raw.goalId, 100);
  if (goalId && !goalIds.includes(goalId)) throw new MarketingStoreError('Bu hedef projede bulunamadı.');
  if (!['awareness', 'traffic', 'registration', 'reactivation'].includes(objective)) throw new MarketingStoreError('Geçersiz kampanya hedefi.');
  const platforms = Array.isArray(channels.social) ? channels.social : [];
  if (!platforms.every(value => typeof value === 'string' && ['linkedin', 'facebook', 'instagram', 'twitter', 'tiktok'].includes(value))) throw new MarketingStoreError('Geçersiz kanal.');
  if (platforms.length === 0 && channels.email !== true) throw new MarketingStoreError('En az bir kanal seçin.');
  const ctaUrl = string(content.ctaUrl, 2048).trim();
  if (ctaUrl) { const url = new URL(ctaUrl); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new MarketingStoreError('Geçersiz hedef bağlantı.'); }
  return { name, ...(goalId ? { goalId } : {}), objective: objective as CreateCampaignInput['objective'], audience: { fillBuckets: [] },
    channels: { social: Array.from(new Set(platforms)) as string[], email: channels.email === true, whatsapp: false, telegram: false, paidAds: [] },
    content: { text, subject: string(content.subject, 200), ctaUrl: ctaUrl || undefined }, timezone };
}

// Growth coach origin of a draft; optional, never required, kept on later edits.
const coachRef = (value: unknown, current?: string) => {
  if (value === undefined) return current ? { coachRef: current } : {};
  if (value === '' || value === null) return {};
  if (typeof value !== 'string' || !COACH_REF.test(value)) throw new MarketingStoreError('Geçersiz büyüme koçu bağlantısı.');
  return { coachRef: value };
};
async function contentInput(raw: Record<string, unknown>, current?: HistoryItem): Promise<HistoryItem> {
  const content = string(raw.content, 100000, current?.content).trim();
  if (!content) throw new MarketingStoreError('İçerik gerekli.');
  const platform = string(raw.platform, 50, current?.platform || 'email');
  if (!['email', 'linkedin', 'facebook', 'instagram', 'twitter', 'telegram', 'tiktok', 'blog'].includes(platform)) throw new MarketingStoreError('Geçersiz kanal.');
  const language = string(raw.language, 10, current?.language || 'tr');
  if (!['tr', 'en'].includes(language)) throw new MarketingStoreError('Geçersiz dil.');
  let images=current?.images;
  if(raw.images!==undefined){
    if(!Array.isArray(raw.images)||raw.images.length>5)throw new MarketingStoreError('En fazla 5 gorsel secin.');
    if(raw.images.length&&platform!=='instagram')throw new MarketingStoreError('Çoklu görsel yalnız Instagram için destekleniyor.');
    const {normalizePublicationImages}=await import('./publication-image');
    images=raw.images.length?(await normalizePublicationImages(raw.images)).map(image=>({data:image.data,mime:'image/jpeg'})):undefined;
  }
  if(images?.length&&platform!=='instagram')throw new MarketingStoreError('Kanal degistirmeden once coklu gorselleri kaldirin.');
  let imageData=current?.imageData,imageMime=current?.imageMime;
  if(raw.imageData===''){imageData=undefined;imageMime=undefined;}
  else if(raw.imageData!==undefined){const image=await normalizePublicationImage(raw.imageData,raw.imageMime);imageData=image.data;imageMime='image/jpeg';}
  if(images?.length&&imageData)throw new MarketingStoreError('Tek gorsel veya coklu gorsel secin; ikisini birlikte gondermeyin.');
  let video=current?.video;
  if(raw.video===''||raw.video===null)video=undefined;
  else if(raw.video!==undefined){const {normalizeContentVideo}=await import('./social-video');video=normalizeContentVideo(raw.video,platform);}
  if(video&&(images?.length||imageData))throw new MarketingStoreError('Video ile görsel aynı içerikte kullanılamaz.');
  if(video&&!['instagram','facebook'].includes(platform))throw new MarketingStoreError('Video yalnız Instagram (Reels, Story) ve Facebook sayfası için destekleniyor.');
  return { id: current?.id || `hist_${randomUUID()}`, timestamp: current?.timestamp || Date.now(),
    content, platform, language, prompt: string(raw.prompt, 3000, current?.prompt),
    headline: string(raw.headline, 200, current?.headline),...(imageData?{imageData,imageMime}:{}),...(images?.length?{images}:{}),...(video?{video}:{}),...(coachRef(raw.coachRef,current?.coachRef)) };
}

async function context(request: NextRequest) {
  const identity = await getSessionIdentity();
  if (identity?.mode !== 'platform') return null;
  if (!['GET', 'HEAD'].includes(request.method) && !hasSameRequestOrigin(request)) throw new MarketingStoreError('İstek kaynağı geçersiz.', 403);
  const access = await getPlatformAccess();
  if (!access) throw new MarketingStoreError('Proje erişimi reddedildi.', 403);
  const store = new ProjectMarketingStore(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId });
  const jobs = new ConnectionJobs(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId });
  const segments=new ProductSegments(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});
  return { store, jobs, segments, workspace: access.repository.workspace(access.subject, access.identity.organizationId, access.identity.projectId)! };
}
function segmentBinding(raw:Record<string,unknown>,segments:ProductSegments,goalId:string,current?:SegmentBinding){
  if(raw.segmentId===undefined&&raw.segmentVersion===undefined){
    if(current?.goalId&&current.goalId!==goalId)throw new MarketingStoreError('Hedef değiştiğinde kitle bağını yeniden seçin veya kaldırın.',409);
    return current;
  }
  if(raw.segmentId===''&&(raw.segmentVersion===0||raw.segmentVersion===undefined))return undefined;
  if(typeof raw.segmentId!=='string'||!/^[a-f0-9]{32}$/.test(raw.segmentId)||!Number.isSafeInteger(raw.segmentVersion))throw new MarketingStoreError('Geçerli kitle kimliği ve sürümü gerekli.');
  if(current?.segmentId===raw.segmentId&&current.segmentVersion===raw.segmentVersion){
    if(current.goalId&&current.goalId!==goalId)throw new MarketingStoreError('Kampanya ve kitle hedefi eşleşmiyor.',409);return current;
  }
  return segments.binding(raw.segmentId,Number(raw.segmentVersion),goalId);
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Geçersiz proje isteği.' }, { status: error instanceof MarketingStoreError ? error.status : 400 });
}
const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function projectCampaignResponse(request: NextRequest, id?: string): Promise<NextResponse | null> {
  try {
    const scope = await context(request);
    if (!scope) return null;
    const { store, workspace } = scope;
    if (request.method === 'GET') {
      if (id) { const item = store.campaign(id); if (!item) throw new MarketingStoreError('Kampanya bulunamadı.', 404); return response(item); }
      const search = (request.nextUrl.searchParams.get('search') || '').toLowerCase();
      const status = request.nextUrl.searchParams.get('status');
      const items = store.listCampaigns().filter(item => (!search || item.name.toLowerCase().includes(search)) && (!status || status === 'all' || item.status === status));
      return response({ items, totalCount: items.length });
    }
    if (request.method === 'DELETE' && id) { store.deleteCampaign(id); return response({ ok: true }); }
    if (request.method === 'POST' && !id) {
      const raw=object(await request.json()),input = campaignInput(raw, workspace.project.timezone, workspace.project.goals.map(goal => goal.id));
      const binding=segmentBinding(raw,scope.segments,input.goalId||'');
      return response(store.saveCampaign({ ...buildCampaign(input), status: 'draft',...(binding?{segmentBinding:binding}:{}),...coachRef(raw.coachRef) }, true), 201);
    }
    if (request.method === 'PATCH' && id) {
      const current = store.campaign(id);
      if (!current) throw new MarketingStoreError('Kampanya bulunamadı.', 404);
      const raw = object(await request.json());
      const input = campaignInput({ name: current.name, goalId: current.goalId, objective: current.objective, channels: current.channels, content: current.content, ...raw }, workspace.project.timezone, workspace.project.goals.map(goal => goal.id));
      const binding=segmentBinding(raw,scope.segments,input.goalId||'',current.segmentBinding);
      const next: UnifiedCampaign = { ...buildCampaign(input), id: current.id, status: 'draft', createdAt: current.createdAt,
        utm: current.utm, updatedAt: new Date().toISOString(),...(binding?{segmentBinding:binding}:{}),...coachRef(raw.coachRef,current.coachRef) };
      next.deliveries = next.deliveries.map((delivery, index) => ({ ...delivery, id: `${current.id}_d${index + 1}` }));
      return response(store.saveCampaign(next, false));
    }
    throw new MarketingStoreError('Desteklenmeyen işlem.', 405);
  } catch (error) { return failure(error); }
}

export async function projectHistoryResponse(request: NextRequest): Promise<NextResponse | null> {
  try {
    const scope = await context(request);
    if (!scope) return null;
    const { store } = scope;
    const id = request.nextUrl.searchParams.get('id') || undefined;
    if (request.method === 'GET') return response(store.history());
    if (request.method === 'DELETE') { store.deleteContent(id); return response({ ok: true }); }
    if (request.method === 'POST') return response(store.saveContent(await contentInput(object(JSON.parse(new TextDecoder().decode(await readBoundedJsonBytes(request,8*1024*1024))))), true), 201);
    if (request.method === 'PATCH' && id) {
      const current = store.history().find(item => item.id === id);
      if (!current) throw new MarketingStoreError('İçerik bulunamadı.', 404);
      return response(store.saveContent(await contentInput(object(JSON.parse(new TextDecoder().decode(await readBoundedJsonBytes(request,8*1024*1024)))), current), false));
    }
    throw new MarketingStoreError('Geçerli içerik kimliği gerekli.');
  } catch (error) { return failure(error); }
}

export async function projectConnectionResponse(request: NextRequest): Promise<NextResponse | null> {
  try {
    const scope = await context(request);
    if (!scope) return null;
    const { store } = scope;
    if (request.method === 'GET') {
      const items = store.connections();
      const id = request.nextUrl.searchParams.get('id');
      if (id) { const item = items.find(item => item.id === id); if (!item) throw new MarketingStoreError('Bağlantı bulunamadı.', 404); return response(item); }
      return response({ items, totalCount: items.length });
    }
    const raw = object(await request.json());
    if (raw.action === 'revoke') { store.revokeConnection(string(raw.id, 160)); return response({ ok: true }); }
    if (!scope.workspace.permissions?.includes('connections.manage')) throw new MarketingStoreError('Bağlantı yönetimi yetkisi gerekli.', 403);
    if (['product_rest','product_webhook','mobile'].includes(String(raw.provider)) || (typeof raw.id==='string' && store.connections().some(item=>item.id===raw.id && ['product_rest','product_webhook','mobile'].includes(item.provider)))) throw new MarketingStoreError('Bu bağlantıyı ilgili Ürün verisi veya Mobil büyüme bölümünden yönetin.');
    return response(store.saveConnection({ id: raw.id === undefined ? undefined : string(raw.id, 160), provider: string(raw.provider, 50), integrationId: string(raw.integrationId, 160, raw.provider === 'social' ? 'social' : ''), accountName: string(raw.accountName, 160), accessToken: string(raw.accessToken, 16384), refreshToken: string(raw.refreshToken, 16384), ...(raw.smtp !== undefined ? { smtp: raw.smtp as SmtpConfiguration } : {}), ...(raw.social !== undefined ? { social: raw.social as SocialConfiguration } : {}) }, credentialEncryptionKey()));
  } catch (error) { return failure(error); }
}

export async function projectAutomationResponse(request: NextRequest): Promise<NextResponse | null> {
  try {
    const scope = await context(request);
    if (!scope) return null;
    if (request.method === 'GET') {
      const id = request.nextUrl.searchParams.get('id') || undefined;
      const result = scope.jobs.list(id);
      return response(id ? result : { items: result });
    }
    const raw = object(await request.json());
    if (raw.action === 'cancel') return response(scope.jobs.cancel(string(raw.id, 160)));
    if (raw.action === 'run') return response(await scope.jobs.run(string(raw.id, 160), credentialEncryptionKey()));
    if (raw.jobType !== 'connection.verify') throw new MarketingStoreError('Bu proje için yalnız bağlantı doğrulama işi etkin.', 409);
    return response(scope.jobs.enqueue(string(raw.connectionId, 160), string(raw.idempotencyKey, 160)), 201);
  } catch (error) { return failure(error); }
}
