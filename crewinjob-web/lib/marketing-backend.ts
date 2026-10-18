import 'server-only';
import { agentModule } from '@/lib/agent-bridge';

type Query = Record<string, unknown>;

export type MarketingBackendApi = {
  marketingContentHistoryGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingContentHistoryPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingContentHistoryDelete: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingPostHistoryGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingPostHistoryPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingActivityGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingActivityPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingCalendarGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingCalendarPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingCalendarDelete: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingAssetGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingAssetPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingAssetDelete: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingAutomationJobGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingAutomationJobPost: (endpoint: string, body?: Query) => Promise<unknown>;
  marketingIntegrationConnectionGet: (endpoint: string, params?: Query) => Promise<unknown>;
  marketingIntegrationConnectionPost: (endpoint: string, body?: Query) => Promise<unknown>;
  siteSeoGet: (endpoint: string, params?: Query) => Promise<unknown>;
  siteSeoPost: (endpoint: string, body?: Query) => Promise<unknown>;
  siteSeoActionGet: (endpoint: string, params?: Query) => Promise<unknown>;
  siteSeoActionPost: (endpoint: string, body?: Query) => Promise<unknown>;
};

export function marketingBackend(): MarketingBackendApi {
  return agentModule<MarketingBackendApi>('modules/api.js');
}

export function records(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  const candidates = [value.items, value.kayitlar, value.data];
  const list = candidates.find(Array.isArray);
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function timestampValue(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value) {
      const parsed = Date.parse(String(value));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return Date.now();
}

export function parseObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch { /* backend eski sürümde JSON string döndürebilir */ }
  }
  return {};
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch { /* düz etiket metni */ }
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

export function backendStatus(error: unknown): number {
  const status = Number((error as { status?: number })?.status || 0);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}
