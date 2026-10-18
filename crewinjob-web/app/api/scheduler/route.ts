import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs   from 'fs';
import path from 'path';
import { agentDir, agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const AGENT_DIR  = agentDir();
const PID_FILE   = path.join(AGENT_DIR, 'data', 'scheduler.pid');
const SCHED_FILE = path.join(AGENT_DIR, 'modules', 'pipeline-scheduler.js');

interface SchedulerStatus {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  uptime: number | null; // seconds
}

function readState(): { pid: number; startedAt: string } | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function getStatus(): SchedulerStatus {
  const state = readState();
  if (!state) return { running: false, pid: null, startedAt: null, uptime: null };
  if (!isAlive(state.pid)) {
    try { fs.unlinkSync(PID_FILE); } catch {}
    return { running: false, pid: null, startedAt: null, uptime: null };
  }
  const uptime = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
  return { running: true, pid: state.pid, startedAt: state.startedAt, uptime };
}

export async function GET() {
  return NextResponse.json({ ok: true, ...getStatus() });
}

export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({})) as { action?: string };

  if (action === 'start') {
    const current = getStatus();
    if (current.running) {
      return NextResponse.json({ ok: false, message: `Scheduler zaten çalışıyor (PID: ${current.pid})` });
    }
    try {
      // Agent config'i (yalnızca agent anahtarları; process.env öncelikli) güncelle
      try {
        agentModule<{ writeAgentConfigFile: (env?: NodeJS.ProcessEnv) => string[] }>('modules/agent-config.js')
          .writeAgentConfigFile(process.env);
      } catch (e) {
        console.warn('[scheduler] agent config yazılamadı:', (e as Error).message);
      }
      const proc = spawn('node', [SCHED_FILE], {
        cwd:      AGENT_DIR,
        detached: true,
        stdio:    'ignore',
      });
      proc.unref();
      const startedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
      fs.writeFileSync(PID_FILE, JSON.stringify({ pid: proc.pid, startedAt }), 'utf-8');
      // Kısa bekle sonra canlılık kontrolü
      await new Promise(r => setTimeout(r, 800));
      const alive = proc.pid ? isAlive(proc.pid) : false;
      if (!alive) {
        try { fs.unlinkSync(PID_FILE); } catch {}
        return NextResponse.json({ ok: false, message: 'Scheduler başlatılamadı — node komutu hata ile çıktı.' });
      }
      return NextResponse.json({ ok: true, message: `Scheduler başlatıldı (PID: ${proc.pid})`, pid: proc.pid, startedAt });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  if (action === 'stop') {
    const current = getStatus();
    if (!current.running || !current.pid) {
      return NextResponse.json({ ok: false, message: 'Scheduler zaten durdurulmuş' });
    }
    try {
      process.kill(current.pid, 'SIGTERM');
      try { fs.unlinkSync(PID_FILE); } catch {}
      return NextResponse.json({ ok: true, message: `Scheduler durduruldu (PID: ${current.pid})` });
    } catch (e: unknown) {
      return NextResponse.json({ ok: false, message: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: false, message: 'Bilinmeyen action' });
}
