// ─── Agent Bridge ─────────────────────────────────────────────────────────────
// Tek bir yerde agentModule() ve tipli yardımcı fonksiyonlar.
// Tüm route handler'lar bu modülü import eder — eval('require') dağılmaz.

import path from 'path';
import type { AllData } from './types';

// eval('require') → webpack'in statik analiz etmesini engeller
const nativeRequire = eval('require') as NodeRequire;

/** Proje kökündeki crewinjob-agent klasörüne göre modül yükler.
 *  T verilmezse any döner (orijinal davranış); typed kullanım için T belirt.
 *  Development modunda require cache'i temizlenerek her seferinde taze yüklenir. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function agentModule<T = any>(relPath: string): T {
  const AGENT    = path.join(process.cwd(), '..', 'crewinjob-agent');
  const fullPath = path.join(AGENT, relPath);
  // Dev modunda: değişiklikler anında devreye girsin
  if (process.env.NODE_ENV === 'development') {
    try { delete nativeRequire.cache[nativeRequire.resolve(fullPath)]; } catch (_) {}
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
