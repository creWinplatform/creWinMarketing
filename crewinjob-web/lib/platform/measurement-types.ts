export const MEASUREMENT_METRICS = {
  ga4: ['eventCount', 'keyEvents', 'totalUsers', 'sessions'],
  search_console: ['clicks', 'impressions'],
  product_webhook: ['event_count', 'unique_entities'],
} as const;
export type MeasurementProvider = keyof typeof MEASUREMENT_METRICS;
export type MeasurementDefinition = { metric: string; eventName: string };
export type MeasurementResult = {
  status: 'ready' | 'partial' | 'no_data'; value: number | null;
  reason: 'provider_partial' | 'no_rows' | 'coverage' | null;
  timezone: string; rows: number; checkedAt: string;
};
export type MeasurementJob = {
  id: string; status: string; bindingId: string; version: number;
  from: string; to: string; resultStatus: string; reason: string | null;
  timezone: string; rows: number; checkedAt: string | null;
  value: number | null; updatedAt: string; fresh: boolean;
  resource: string | null; sourceName: string | null;
};
export type MeasurementSource = { id: string; name: string; provider: MeasurementProvider; resource: string; version: number | null; eventNames: string[] };
export type MeasurementBinding = {
  id: string; version: number; goalId: string; stageIndex: number;
  connectionId: string; sourceName: string; resource: string; provider: MeasurementProvider; definition: MeasurementDefinition;
  enabled: boolean; valid: boolean; nextSyncAt: string | null; latest: MeasurementJob | null; active: MeasurementJob | null;
};
export type MeasurementWorkspace = { bindings: MeasurementBinding[]; sources: MeasurementSource[]; canManage: boolean; from: string; to: string };
export const MEASUREMENT_STATUS: Record<string, [string, string]> = {
  pending: ['Bekliyor', 'Pending'], ready: ['Ölçüldü', 'Measured'],
  partial: ['Eksik kapsam', 'Partial coverage'], no_data: ['Veri yok', 'No data'],
  failed: ['Alınamadı', 'Failed'], blocked: ['Erişim veya ayar değişti', 'Access or settings changed'],
};
export const MEASUREMENT_METRIC_LABELS: Record<string, [string, string]> = {
  eventCount: ['Olay sayısı', 'Event count'], keyEvents: ['GA4 önemli olaylar', 'GA4 key events'],
  totalUsers: ['Dönemdeki kullanıcılar', 'Users in period'], sessions: ['Oturumlar', 'Sessions'],
  clicks: ['Organik tıklamalar', 'Organic clicks'], impressions: ['Organik gösterimler', 'Organic impressions'],
  event_count: ['Alınan ürün olayları', 'Received product events'], unique_entities: ['Olayı yapan benzersiz kayıtlar', 'Unique event entities'],
};
export function defaultMeasurementPeriod(provider: MeasurementProvider = 'ga4', now = Date.now()) {
  const to = new Date(now - (provider === 'product_webhook' ? 1 : 3) * 86400000).toISOString().slice(0, 10);
  return { from: new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10), to };
}
