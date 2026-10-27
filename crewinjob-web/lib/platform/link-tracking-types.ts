// Links to the project's own site in approved social posts carry utm_source/utm_medium/utm_campaign; GA4 then reports
// the sessions and key events that arrived through each tagged link. Counts are observed arrivals, never credited causes.
export const LINK_TAG = /^rz_[a-f0-9]{10}$/;
// Instagram captions are not clickable, so Instagram posts are never tagged.
export const LINK_SOURCES: Record<string, string> = { linkedin: 'linkedin', facebook: 'facebook', twitter: 'x', telegram: 'telegram' };
export type LinkSyncState = 'idle' | 'refreshing' | 'ready' | 'failed' | 'blocked';
export type LinkResultState = 'ready' | 'partial' | 'no_data';
export type LinkTrackingView = {
  enabled: boolean; canManage: boolean; website: string;
  connectionId: string | null; connections: { id: string; name: string; property: string }[];
  state: LinkSyncState; reason: string | null; resultState: LinkResultState | null;
  from: string | null; to: string | null; checkedAt: string | null; attemptedAt: string | null; nextSyncAt: string | null;
  tagged: number;
};
// Per accepted publication: what GA4 reported for its tagged link and channel in the stored period.
export type PublicationSiteResult = {
  status: 'not_connected' | 'pending' | 'ready' | 'partial' | 'none' | 'failed';
  sessions: number | null; keyEvents: number | null; from: string | null; to: string | null; checkedAt: string | null;
};
export type SiteChannel = { source: string; posts: number; sessions: number; keyEvents: number };
export type SitePost = { title: string; source: string; sessions: number; keyEvents: number; publishedAt: string | null };
export type SiteSummary = {
  resultState: LinkResultState; from: string; to: string; checkedAt: string;
  posts: number; byChannel: SiteChannel[]; top: SitePost[];
};
export const LINK_REASONS: Record<string, [string, string]> = {
  provider_unavailable: ['Google Analytics raporu alınamadı. Bağlantıyı ve mülk erişimini kontrol edin; son başarılı sonuç korunur.', 'The Google Analytics report could not be read. Check the connection and property access; the last successful result is kept.'],
  changed: ['Google Analytics bağlantısı veya yetki değişti. Mülkü yeniden seçin.', 'The Google Analytics connection or access changed. Choose the property again.'],
};
