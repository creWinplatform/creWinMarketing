import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs   from 'fs';
import { execFile } from 'child_process';
import { agentDir, agentModule } from '@/lib/agent-bridge';
import { readJson, writeJsonAtomic } from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const AGENT_DIR  = agentDir();
const QUEUE_FILE = path.join(AGENT_DIR, 'job-queue.json');
const CLI_SCRIPT = path.join(AGENT_DIR, 'job-bot-cli.js');
const STATE_FILE = path.join(AGENT_DIR, 'data', 'pipeline-state.json');

// ── Config ────────────────────────────────────────────────────────────────────
// .userbot-config.json'a YALNIZCA agent'ın ihtiyaç duyduğu anahtarlar yazılır
// (TG_*, TELEGRAM_*, REPORT_CHAT_ID, GEMINI_API_KEY, CREWINJOB_API_*): önce web process.env,
// sonra agent .env. Eskiden agent .env'in TAMAMI kopyalanıyordu. Her CLI çağrısından önce
// güncellenir (içerik değişmediyse dosyaya dokunulmaz).
function ensureConfig() {
  try {
    agentModule<{ writeAgentConfigFile: (env?: NodeJS.ProcessEnv) => string[] }>('modules/agent-config.js')
      .writeAgentConfigFile(process.env);
  } catch (e) {
    console.warn('[job-bot] agent config yazılamadı:', (e as Error).message);
  }
}

// ── CLI çağırıcı ──────────────────────────────────────────────────────────────
// Pipeline işlemleri uzun sürer — ayrı timeout
const PIPELINE_ACTIONS = new Set([
  'run_pipeline', 'discover_groups', 'join_groups', 'broadcast_jobs',
  'approve_review', 'manage_expiry', 'track_applications',
]);
// job-bot-cli.js LONG_ACTIONS ile aynı — bunlar pipeline-state.json'a "running" yazar
const STATEFUL_ACTIONS = new Set([
  'run_pipeline', 'discover_groups', 'join_groups', 'broadcast_jobs',
  'track_applications', 'manage_expiry',
]);

type PipelineState = {
  running: string | null; startedAt?: string | null; finishedAt?: string | null;
  lastAction?: string | null; lastResult?: unknown; pid?: number;
};

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

// Çocuk süreç timeout/çökme ile öldüyse CLI'nin finally bloğu çalışmaz → durum "running"
// olarak takılı kalıyordu. Burada "çalışmıyor" olarak işaretle.
function markPipelineStopped(action: string, reason: string) {
  const prev = readJson<PipelineState>(STATE_FILE, { running: null });
  if (prev.running && prev.running !== action) return; // başka bir işlem çalışıyor — dokunma
  try {
    writeJsonAtomic(STATE_FILE, {
      running: null,
      startedAt: prev.startedAt || null,
      finishedAt: new Date().toISOString(),
      lastAction: prev.running || action,
      lastResult: { ok: false, error: reason },
    }, false);
  } catch { /* durum dosyası yazılamazsa sessiz geç */ }
}

class CliTimeoutError extends Error {}

// stdout'un son JSON satırını al (CLI logları stderr'e gider; yine de eski/yabancı log satırlarına dayanıklı)
function parseCliJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* son satırı dene */ }
  const lastLine = trimmed.split(/\r?\n/).reverse().find(l => l.trim().startsWith('{'));
  if (!lastLine) return null;
  try { return JSON.parse(lastLine.trim()); } catch { return null; }
}

function runCli(action: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  ensureConfig();
  const timeout = PIPELINE_ACTIONS.has(action) ? 600000 : 30000; // 10dk pipeline, 30s diğerleri
  return new Promise((resolve, reject) => {
    const args = [CLI_SCRIPT, action, JSON.stringify(input)];
    execFile('node', args, { cwd: AGENT_DIR, timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const execErr = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }) | null;
        const timedOut = !!execErr && execErr.killed === true && !!execErr.signal
          && execErr.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        const result = parseCliJson(stdout || '');

        if (execErr && STATEFUL_ACTIONS.has(action)) {
          markPipelineStopped(action, timedOut ? `zaman aşımı (${timeout / 1000} sn)` : 'süreç beklenmedik şekilde sonlandı');
        }
        if (timedOut && !result) {
          reject(new CliTimeoutError(
            `İşlem zaman aşımına uğradı (${Math.round(timeout / 1000)} sn) ve durduruldu: ${action}. ` +
            'O ana kadarki ilerleme kaydedildi; kalan kısım için işlemi tekrar başlatabilirsiniz.'));
          return;
        }
        if (result) { resolve(result); return; }
        if (execErr) {
          // stderr artık modül loglarını da içerir — yalnızca son satırları göster
          const tail = (stderr || '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 500);
          reject(new Error(tail || execErr.message));
          return;
        }
        reject(new Error(`CLI çıktısı JSON değil: ${(stdout || '').slice(0, 200)}`));
      }
    );
  });
}

// ── Kuyruk doğrudan oku (hızlı — CLI gerektirmez) ────────────────────────────
function readQueue(): unknown[] {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); }
  catch { return []; }
}

// ── GET ────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'positions') {
    try {
      const result = await runCli('positions');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, positions: [], error: (e as Error).message });
    }
  }

  if (action === 'countries') {
    try {
      const result = await runCli('countries');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, countries: [], error: (e as Error).message });
    }
  }

  if (action === 'companies') {
    try {
      const result = await runCli('companies');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, companies: [], error: (e as Error).message });
    }
  }

  if (action === 'languages') {
    try {
      const result = await runCli('languages');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, languages: [], error: (e as Error).message });
    }
  }

  if (action === 'certificates') {
    try {
      const result = await runCli('certificates');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, certificates: [], error: (e as Error).message });
    }
  }

  if (action === 'cities') {
    const countryId = searchParams.get('countryId');
    if (!countryId) return NextResponse.json({ ok: true, cities: [] });
    try {
      const result = await runCli('cities', { countryId: Number(countryId) });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, cities: [], error: (e as Error).message });
    }
  }

  // Keşfedilen ama katılınmamış gruplar: katılma yalnız buradan seçilip onaylanarak yapılır.
  if (action === 'suggested_groups') {
    try {
      const result = await runCli('suggested_groups');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, groups: [], error: (e as Error).message });
    }
  }

  if (action === 'discovered_groups') {
    try {
      const result = await runCli('joined_groups');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, groups: [], error: (e as Error).message });
    }
  }

  if (action === 'posted_jobs') {
    try {
      const result = await runCli('posted_jobs');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, jobs: [], error: (e as Error).message });
    }
  }

  if (action === 'job_stats') {
    try {
      const result = await runCli('job_stats');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, jobs: [], error: (e as Error).message });
    }
  }

  if (action === 'pipeline_logs') {
    try {
      const result = await runCli('pipeline_logs');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, lines: [], error: (e as Error).message });
    }
  }

  // Durum dosyasını doğrudan oku (CLI başlatma — her 2s çağrılır, hızlı olmalı)
  if (action === 'pipeline_status') {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PipelineState;
      // Süreç öldüyse (çökme/kill) "running" takılı kalmasın
      if (state.running && typeof state.pid === 'number' && !isPidAlive(state.pid)) {
        markPipelineStopped(state.running, 'süreç beklenmedik şekilde sonlandı');
        return NextResponse.json({ ok: true, ...readJson<PipelineState>(STATE_FILE, { running: null }) });
      }
      return NextResponse.json({ ok: true, ...state });
    } catch {
      return NextResponse.json({ ok: true, running: null, startedAt: null, finishedAt: null });
    }
  }

  if (action === 'review_queue') {
    try {
      const result = await runCli('review_queue');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, queue: [], error: (e as Error).message });
    }
  }

  if (action === 'group_stats') {
    try {
      const result = await runCli('group_stats');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, stats: [], error: (e as Error).message });
    }
  }

  if (action === 'api_usage') {
    try {
      const result = await runCli('api_usage');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, usage: {}, error: (e as Error).message });
    }
  }

  if (action === 'agent_config') {
    try {
      const result = await runCli('get_config');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, config: {}, error: (e as Error).message });
    }
  }

  // Default: kuyruk + stats
  const queue = readQueue() as Array<{ status: string }>;
  const stats = {
    total:   queue.length,
    pending: queue.filter(i => i.status === 'pending').length,
    posted:  queue.filter(i => i.status === 'posted').length,
    errors:  queue.filter(i => i.status === 'error').length,
  };
  return NextResponse.json({ ok: true, queue, stats });
}

// ── POST ───────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { action } = body;

  if (action === 'parse_ai') {
    const text = (body.text as string || '').trim();
    if (!text) return NextResponse.json({ ok: false, message: 'Metin boş — lütfen ilan metnini yapıştır' });
    try {
      const result = await runCli('parse_ai', { text });
      return NextResponse.json(result.ok ? result : { ok: false, message: (result as { error?: string }).error || 'Parse başarısız' });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'generate_ai') {
    const hint = (body.hint as string || '').trim();
    try {
      const result = await runCli('generate_ai', { hint });
      return NextResponse.json(result.ok ? result : { ok: false, message: (result as { error?: string }).error || 'Üretim başarısız' });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'add_to_queue') {
    const { jobData, source } = body as { jobData: Record<string, unknown>; source?: string };
    if (!jobData?.positionId) return NextResponse.json({ ok: false, message: 'Pozisyon seçimi zorunlu' });
    try {
      const result = await runCli('add_to_queue', { jobData, source: source || 'manual' });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'create_direct') {
    const { jobData } = body as { jobData: Record<string, unknown> };
    if (!jobData?.positionId) return NextResponse.json({ ok: false, message: 'Pozisyon seçimi zorunlu' });
    try {
      const result = await runCli('create_direct', { jobData });
      if (result.ok) {
        const r = result.result as { id?: number; url?: string } | null;
        return NextResponse.json({ ...result, message: 'İlan başarıyla oluşturuldu!', ilanId: r?.id || null, ilanUrl: r?.url || null });
      }
      return NextResponse.json({ ok: false, message: (result as { error?: string }).error || 'API hatası' });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'approve') {
    const { id } = body as { id: string };
    if (!id) return NextResponse.json({ ok: false, message: 'ID eksik' });
    try {
      const result = await runCli('approve', { id });
      if (result.ok) {
        const r = result.result as { id?: number; url?: string } | null;
        return NextResponse.json({ ...result, message: 'İlan yayınlandı!', ilanId: r?.id || null, ilanUrl: r?.url || null });
      }
      return NextResponse.json({ ok: false, message: (result as { error?: string }).error || 'Hata' });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'update') {
    const { id, jobData } = body as { id: string; jobData: Record<string, unknown> };
    if (!id) return NextResponse.json({ ok: false, message: 'ID eksik' });
    try {
      const result = await runCli('update', { id, jobData });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'remove') {
    const { id } = body as { id: string };
    if (!id) return NextResponse.json({ ok: false, message: 'ID eksik' });
    try {
      const result = await runCli('remove', { id });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'run_pipeline') {
    try {
      const result = await runCli('run_pipeline', {
        maxJobs: (body.maxJobs as number) || 15,
        dryRun:  (body.dryRun  as boolean) || false,
      });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'discover_groups') {
    try {
      const result = await runCli('discover_groups');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  // Yalnız bir kişinin seçtiği öneri gruplarına katılır (en fazla 10); hiçbir şey seçilmezse reddedilir.
  if (action === 'join_groups') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)) : [];
    if (!ids.length || ids.length > 10) return NextResponse.json({ ok: false, message: 'Katılmak için 1–10 grup seçin.' }, { status: 400 });
    try {
      const result = await runCli('join_groups', { ids });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'broadcast_jobs') {
    try {
      const result = await runCli('broadcast_jobs', {
        maxJobs:   (body.maxJobs   as number) || 5,
        maxGroups: (body.maxGroups as number) || 20,
      });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'approve_review') {
    const { id, positionId } = body as { id: string; positionId?: number };
    if (!id) return NextResponse.json({ ok: false, message: 'ID eksik' });
    try {
      const result = await runCli('approve_review', { id, positionId: positionId || null });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'reject_review') {
    const { id } = body as { id: string };
    if (!id) return NextResponse.json({ ok: false, message: 'ID eksik' });
    try {
      const result = await runCli('reject_review', { id });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'bulk_reject') {
    const { ids } = body as { ids?: unknown };
    // Boş liste TÜM kuyruğu reddetmesin — tümünü temizlemek için clear_queue kullanılır
    const cleanIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    if (!cleanIds.length) return NextResponse.json({ ok: false, message: 'Reddedilecek ilan seçilmedi (ids boş)' }, { status: 400 });
    try {
      const result = await runCli('bulk_reject', { ids: cleanIds });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'clear_queue') {
    try {
      const result = await runCli('clear_queue', {});
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'dismiss_groups') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)) : [];
    if (!ids.length) return NextResponse.json({ ok: false, message: 'Listeden çıkarmak için grup seçin.' }, { status: 400 });
    try {
      const result = await runCli('dismiss_groups', { ids });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'set_config') {
    try {
      const result = await runCli('set_config', body as Record<string, unknown>);
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'manage_expiry') {
    try {
      const result = await runCli('manage_expiry');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'send_daily_report') {
    try {
      const result = await runCli('send_daily_report');
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'track_applications') {
    try {
      const result = await runCli('track_applications', { maxCheck: (body.maxCheck as number) || 20 });
      return NextResponse.json(result);
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: false, message: 'Bilinmeyen işlem' });
}
