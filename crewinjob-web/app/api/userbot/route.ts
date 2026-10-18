import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import fs   from 'fs';
import path from 'path';
import { agentDir, agentModule } from '@/lib/agent-bridge';
import { writeTextAtomic } from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const AGENT_DIR   = agentDir();
const ENV_FILE    = path.join(AGENT_DIR, '.env');
const LOG_FILE    = path.join(AGENT_DIR, 'userbot.log');
const GROUPS_FILE = path.join(AGENT_DIR, '.userbot-groups.json');
const MAX_LOGS    = 200;

// ── Singleton process ─────────────────────────────────────────────────────────
let botProc: ChildProcess | null = null;

function isRunning() {
  return botProc !== null && !botProc.killed && botProc.exitCode === null;
}

// ── Agent config (ortak modül: crewinjob-agent/modules/agent-config.js) ──────
type AgentConfigModule = {
  collectAgentConfig: (env?: NodeJS.ProcessEnv) => Record<string, string>;
  writeAgentConfigFile: (env?: NodeJS.ProcessEnv) => string[];
};
function agentConfig(): AgentConfigModule {
  return agentModule<AgentConfigModule>('modules/agent-config.js');
}

// Etkin config: önce web process.env, sonra agent .env (yalnızca agent anahtarları) —
// userbot sürecinin göreceği değerlerle aynı öncelik.
function readEnv(): Record<string, string> {
  try { return agentConfig().collectAgentConfig(process.env); } catch { return {}; }
}

// .env anahtar enjeksiyonunu önle: değer CR/LF/NUL içeremez (yeni satır = yeni KEY=VALUE).
const ENV_VALUE_FORBIDDEN = /[\r\n\0]/;
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

function writeEnvKey(key: string, value: string) {
  if (!ENV_KEY_RE.test(key)) throw new Error(`Geçersiz anahtar: ${key}`);
  if (ENV_VALUE_FORBIDDEN.test(value)) throw new Error('Değer satır sonu / NUL karakteri içeremez');
  let content = '';
  try { content = fs.readFileSync(ENV_FILE, 'utf-8'); } catch {}
  const re = new RegExp(`^${key}=.*$`, 'm');
  // Fonksiyon replacer: değerdeki "$&", "$1" gibi diziler özel anlam taşımasın
  if (re.test(content)) {
    content = content.replace(re, () => `${key}=${value}`);
  } else {
    content += `${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
  }
  writeTextAtomic(ENV_FILE, content);
}

// Telegram kanal/grup: @kullaniciadi (4-64, harf/rakam/_) veya sayısal -100… ID
const CHANNEL_RE = /^(@?[A-Za-z0-9_]{4,64}|-100\d{5,20})$/;

function appendLog(line: string) {
  const ts  = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  const entry = `[${ts}] ${line.trim()}\n`;
  fs.appendFileSync(LOG_FILE, entry, 'utf-8');
}

function readLogs(n = 100): string[] {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
    return raw.split('\n').filter(Boolean).slice(-n);
  } catch { return []; }
}

// ── t.me URL'lerini @username formatına çevir ─────────────────────────────────
function normalizeChannel(ch: string): string {
  ch = ch.trim();
  const m = ch.match(/t\.me\/([^?/\s]+)/);
  if (m) return `@${m[1]}`;
  if (ch && !ch.startsWith('@') && !ch.startsWith('-') && !/^\d/.test(ch)) return `@${ch}`;
  return ch;
}

// ── Log istatistikleri ────────────────────────────────────────────────────────
function parseStats(logs: string[]) {
  let joined = 0, dms = 0, jobs = 0;
  for (const l of logs) {
    if (l.includes('Grup katıldı') || l.includes('Katıldı:')) joined++;
    if (l.includes('DM gönderildi')) dms++;
    if (l.includes('İlan tespit')) jobs++;
  }
  return { joined, dms, jobs };
}

function readGroups() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8')); } catch { return []; }
}

// ── GET: durum + loglar + config ──────────────────────────────────────────────
export async function GET() {
  const env  = readEnv();
  const logs = readLogs(MAX_LOGS);
  return NextResponse.json({
    running:     isRunning(),
    hasSession:  !!(env.TG_SESSION),
    channels:    (env.TG_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean),
    botUsername: env.TG_BOT_USERNAME || '',
    logs,
    stats:       parseStats(logs),
    groups:      readGroups(),
  });
}

// ── POST: start / stop / config ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action } = body as { action: string; [k: string]: unknown };

  // ── Başlat ──────────────────────────────────────────────────────────────────
  if (action === 'start') {
    if (isRunning()) return NextResponse.json({ ok: false, message: 'Zaten çalışıyor' });

    const env = readEnv();
    if (!env.TG_SESSION) return NextResponse.json({ ok: false, message: 'TG_SESSION eksik — önce oturum ekle' });

    // Log dosyasını temizle (isteğe bağlı: ilk 50 satırı koru)
    try {
      const prev = readLogs(50).join('\n');
      fs.writeFileSync(LOG_FILE, prev ? prev + '\n' : '', 'utf-8');
    } catch {}

    appendLog('▶ Userbot başlatılıyor...');

    // dotenvx v17, base64'deki + ve = karakterlerini bozuyor.
    // Config'i JSON dosyaya yaz → userbot.js oradan okur, dotenvx'i hiç çağırmaz.
    // Yalnızca agent anahtarları yazılır (web'in diğer sırları kopyalanmaz).
    try { agentConfig().writeAgentConfigFile(process.env); }
    catch (e) { return NextResponse.json({ ok: false, message: `Config yazılamadı: ${(e as Error).message}` }); }

    botProc = spawn('node', ['userbot.js'], {
      cwd:   AGENT_DIR,
      stdio: 'pipe',
      env:   { ...process.env, PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', FORCE_COLOR: '0' },
    });

    const proc1 = botProc;
    proc1.stdout?.on('data', (d: Buffer) => {
      String(d).split('\n').filter(Boolean).forEach(appendLog);
    });
    proc1.stderr?.on('data', (d: Buffer) => {
      String(d).split('\n').filter(Boolean).forEach(l => appendLog(`⚠ ${l}`));
    });
    proc1.on('exit', (code) => {
      appendLog(`■ Userbot durdu (exit ${code ?? '?'})`);
      botProc = null;
    });

    return NextResponse.json({ ok: true, message: 'Userbot başlatıldı' });
  }

  // ── Durdur ──────────────────────────────────────────────────────────────────
  if (action === 'stop') {
    if (botProc) {
      botProc.kill('SIGTERM');
      botProc = null;
      appendLog('■ Userbot durduruldu (kullanıcı)');
    }
    return NextResponse.json({ ok: true, message: 'Durduruldu' });
  }

  // ── Oturum kaydet ────────────────────────────────────────────────────────────
  if (action === 'save_session') {
    const { session } = body as { session: string };
    const s = session?.trim() || '';
    // gramjs StringSession her zaman "1" ile başlar ve uzun bir base64 dizisidir.
    // Bu kontrol, tarayıcı şifre yöneticisinin yanlışlıkla parola yazmasını engeller.
    // StringSession base64 karakter kümesi dışında bir şey (özellikle CR/LF → .env enjeksiyonu) kabul etme
    if (!s.startsWith('1') || s.length < 100 || !/^[A-Za-z0-9+/=_-]+$/.test(s)) {
      return NextResponse.json({
        ok: false,
        message: 'Geçersiz session — "1BAA..." ile başlayan, node userbot-auth.js çıktısındaki uzun değeri yapıştır.',
      }, { status: 400 });
    }
    try { writeEnvKey('TG_SESSION', s); }
    catch (e) { return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 }); }
    return NextResponse.json({ ok: true, message: 'Oturum kaydedildi' });
  }

  // ── Kanal ekle / sil ─────────────────────────────────────────────────────────
  if (action === 'set_channels') {
    const { channels } = body as { channels?: unknown };
    if (channels !== undefined && !Array.isArray(channels)) {
      return NextResponse.json({ ok: false, message: 'channels bir dizi olmalı' }, { status: 400 });
    }
    const list = (Array.isArray(channels) ? channels : []).filter((c): c is string => typeof c === 'string');
    const normalized = list.map(normalizeChannel).filter(Boolean);
    const invalid = normalized.filter(c => !CHANNEL_RE.test(c));
    if (invalid.length) {
      return NextResponse.json({
        ok: false,
        message: `Geçersiz kanal: ${invalid.slice(0, 5).map(c => JSON.stringify(c.slice(0, 70))).join(', ')} — @kullaniciadi (4-64 harf/rakam/_) veya -100… ID olmalı`,
      }, { status: 400 });
    }
    try { writeEnvKey('TG_CHANNELS', normalized.join(',')); }
    catch (e) { return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 }); }
    return NextResponse.json({ ok: true, message: 'Kanallar güncellendi', channels: normalized });
  }

  // ── Yeniden başlat ───────────────────────────────────────────────────────────
  if (action === 'restart') {
    if (botProc) { botProc.kill('SIGTERM'); botProc = null; }
    await new Promise(r => setTimeout(r, 1500));

    const env = readEnv();
    if (!env.TG_SESSION) return NextResponse.json({ ok: false, message: 'TG_SESSION eksik' });

    appendLog('🔄 Userbot yeniden başlatılıyor...');
    try { agentConfig().writeAgentConfigFile(process.env); }
    catch (e) { return NextResponse.json({ ok: false, message: `Config yazılamadı: ${(e as Error).message}` }); }

    botProc = spawn('node', ['userbot.js'], {
      cwd:   AGENT_DIR,
      stdio: 'pipe',
      env:   { ...process.env, PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', FORCE_COLOR: '0' },
    });
    const proc2 = botProc;
    proc2.stdout?.on('data', (d: Buffer) => String(d).split('\n').filter(Boolean).forEach(appendLog));
    proc2.stderr?.on('data', (d: Buffer) => String(d).split('\n').filter(Boolean).forEach(l => appendLog(`⚠ ${l}`)));
    proc2.on('exit', (code) => { appendLog(`■ Userbot durdu (exit ${code ?? '?'})`); botProc = null; });

    return NextResponse.json({ ok: true, message: 'Yeniden başlatıldı' });
  }

  // ── Logları temizle ──────────────────────────────────────────────────────────
  if (action === 'clear_logs') {
    try { fs.writeFileSync(LOG_FILE, '', 'utf-8'); } catch {}
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: 'Bilinmeyen işlem' });
}
