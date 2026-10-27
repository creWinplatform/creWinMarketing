import type { PublicationSiteResult } from './link-tracking-types';
export type PublicationSource = { story?: boolean; kind: 'content' | 'campaign'; id: string; platform: string; title: string; text: string; digest: string; eligible: boolean; imagePreview?: string; imagePreviews?: string[]; format?: 'text'|'image'|'carousel'|'reel'|'story'|'video'; video?: { url: string; format: 'reel'|'story'|'feed'; bytes?: number }; weightedLength?: number; trackedLinks?: number };
export type PublicationTarget = { id: string; name: string; platform: string; accountId: string; accountType?:'person'|'organization'; revision: string; configured: boolean; ready: boolean; checkedAt: string | null; expiresAt?: string | null };
export type Publication = {
  id: string; mode: 'rehearsal' | 'publish'; status: string; state: string;
  title: string; text: string; platform: string; accountName: string; accountId: string; accountType?:'person'|'organization';
  sourceKind: 'content' | 'campaign'; sourceId: string; scheduledAt: string; timezone: string;
  submittedAt: string | null; updatedAt: string; reason: string | null;
  providerPostId: string | null; providerUrl: string | null; cancelRequested: boolean;
  nextCheckAt: string | null; image?: {width:number;height:number;bytes:number;previewUrl:string};
  images?: {width:number;height:number;bytes:number;previewUrl:string}[];
  format?: 'text'|'image'|'carousel'|'reel'|'story'|'video'; video?: { url: string; format: 'reel'|'story'|'feed'; bytes?: number };
  engagement?: PublicationEngagement; site?: PublicationSiteResult;
};
export type EngagementCounts = Partial<Record<'likes'|'comments'|'shares'|'impressions'|'clicks'|'reach'|'bookmarks'|'quotes',number>>;
export type PublicationEngagement = { status:'not_requested'|'refreshing'|'ready'|'unavailable'|'unsupported'; counts:EngagementCounts; observedAt:string|null; attemptedAt:string|null };
export type PublicationWorkspace = { items: Publication[]; total: number; page: number; sources: PublicationSource[]; sourceTotal: number; targets: PublicationTarget[]; canManage: boolean; configured: boolean; publishingEnabled: boolean; timezone: string };
export const PUBLICATION_LABELS: Record<string, [string,string]> = {
  pending: ['Kuyrukta', 'Queued'], checking: ['Kontrol ediliyor', 'Checking'], submitting: ['Sağlayıcıya iletiliyor', 'Submitting'],
  preparing: ['Görsel hazırlanıyor', 'Preparing image'], container_processing: ['Instagram görseli işliyor', 'Instagram is processing the image'],
  accepted: ['Sağlayıcı kabul etti', 'Provider accepted'], rehearsed: ['Prova tamamlandı', 'Rehearsal completed'],
  rejected: ['Sağlayıcı reddetti', 'Provider rejected'], uncertain: ['Sonuç belirsiz', 'Outcome uncertain'],
  blocked: ['Durduruldu', 'Blocked'], cancelled: ['İptal edildi', 'Cancelled'],
};
export const PUBLICATION_REASONS: Record<string,[string,string]> = {
  changed: ['İçerik, bağlantı veya yetki değişti. Yeniden inceleyin.', 'Content, connection or authority changed. Review again.'],
  unavailable: ['Yayın izni doğrulanamadı. Bağlantıyı ve uygulama ayarlarını kontrol edin.', 'Publishing access could not be verified. Check the connection and app setup.'],
  interrupted: ['Gönderim sonucu doğrulanamadı. Tekrar yayınlamadan önce ilgili sosyal hesabı kontrol edin.', 'Submission outcome is unknown. Check the social account before publishing again.'],
  cancelled: ['İletilmeden önce iptal edildi.', 'Cancelled before submission.'],
  expired: ['Planlanan saat üzerinden 24 saat geçti; otomatik yayın yapılmadı.', 'More than 24 hours past schedule; automatic publishing was blocked.'],
  limit: ['Günlük pilot yayın sınırına ulaşıldı.', 'Daily pilot publishing limit reached.'],
  container_unknown: ['Görsel hazırlama sonucu doğrulanamadı. Yayın isteği gönderilmedi; otomatik tekrar yapılmayacak.', 'Image preparation outcome is unknown. No publish request was sent; there will be no automatic retry.'],
  media_failed: ['Instagram görseli hazırlayamadı. Görseli ve bağlantıyı kontrol edin.', 'Instagram could not prepare the image. Check the image and connection.'],
  media_expired: ['Görsel hazırlama süresi doldu; yayın yapılmadı.', 'Image preparation expired; no post was published.'],
};
