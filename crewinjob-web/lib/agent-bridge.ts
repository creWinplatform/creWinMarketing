// ─── Agent Bridge ─────────────────────────────────────────────────────────────
// Tek bir yerde agentModule() ve tipli yardımcı fonksiyonlar.
// Tüm route handler'lar bu modülü import eder — eval('require') dağılmaz.

import fs from 'fs';
import path from 'path';
import type { AllData } from './types';

// eval('require') → webpack'in statik analiz etmesini engeller
const nativeRequire = eval('require') as NodeRequire;

// Dev modunda modülün en son yüklendiği andaki mtime'ı (globalThis: HMR'da kaybolmasın)
const g = globalThis as typeof globalThis & { __crewinAgentMtimes?: Map<string, number> };
const loadedMtimes: Map<string, number> = g.__crewinAgentMtimes ?? (g.__crewinAgentMtimes = new Map());

/** crewinjob-agent klasörünün mutlak yolu. CREWINJOB_AGENT_DIR ile değiştirilebilir (Docker: /crewinjob-agent). */
export function agentDir(): string {
  return process.env.CREWINJOB_AGENT_DIR
    ? path.resolve(process.env.CREWINJOB_AGENT_DIR)
    : path.join(process.cwd(), '..', 'crewinjob-agent');
}

/** crewinjob-agent klasörüne göre modül yükler.
 *  T verilmezse any döner (orijinal davranış); typed kullanım için T belirt.
 *  Development modunda dosya değiştiyse (mtime) require cache temizlenir; değişmediyse
 *  modül-içi durum (API token cache, 90 sn veri cache) korunur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function agentModule<T = any>(relPath: string): T {
  const fullPath = path.join(agentDir(), relPath);
  if (process.env.NODE_ENV === 'development') {
    try {
      const resolved = nativeRequire.resolve(fullPath);
      const mtime    = fs.statSync(resolved).mtimeMs;
      if (loadedMtimes.get(resolved) !== mtime) {
        delete nativeRequire.cache[resolved];
        loadedMtimes.set(resolved, mtime);
      }
    } catch (_) {}
  }
  return nativeRequire(fullPath) as T;
}

// ── Tipli erişim yardımcıları ─────────────────────────────────────────────────

/** Tüm istatistikleri çeker (60 sn cache'li) */
export async function fetchAllData(): Promise<AllData> {
  const api = agentModule<{ fetchAllData: () => Promise<AllData> }>('modules/api.js');
  return api.fetchAllData();
}

/** İçerik üretiminde kullanılan tek generate çağrısı */
export async function generateContent(
  type: string,
  params: Record<string, unknown>,
  data: AllData,
  textModel?: string,
): Promise<string> {
  switch (type) {
    case 'social': {
      const gen = agentModule<{
        generateSinglePlatform: (platform: string, contentType: string, data: AllData, model?: string) => Promise<string>;
        generateWithCustomPrompt: (platform: string, customPrompt: string, data: AllData, model?: string, lang?: string, tone?: string) => Promise<string>;
      }>('generator.js');
      if (params.customPrompt) {
        return gen.generateWithCustomPrompt(
          String(params.platform ?? ''),
          String(params.customPrompt),
          data,
          textModel,
          String(params.language ?? 'en'),
          String(params.tone ?? ''),
        );
      }
      return gen.generateSinglePlatform(
        String(params.platform ?? ''),
        String(params.contentType ?? ''),
        data,
        textModel,
      );
    }
    default:
      throw new Error(`generateContent: tip desteklenmiyor — ${type}`);
  }
}
