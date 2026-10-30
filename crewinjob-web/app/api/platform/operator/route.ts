import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin, panelOrigin } from '@/lib/platform/request-origin';
import { platformDatabase } from '@/lib/platform/database';
import { operatorFunnel, operatorReadiness, probeGemini } from '@/lib/platform/operator';
import { probeGoogle, probeMeta, serverSetup } from '@/lib/platform/server-setup';
import { goLiveChecklist, setChecklistItem } from '@/lib/platform/go-live-checklist';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
// Operator console: only the deployment administrator (the team running Ryzevo), never a customer session.
async function operator(permission?: 'members.manage') {
  const access = await getPlatformAccess(permission);
  return access && access.subject === 'legacy-admin' ? access : null;
}
// The database's folder holds the key file and the go-live checklist (an isolated QA database keeps its own).
const dataDir = () => dirname(process.env.PLATFORM_DATABASE_PATH || join(process.cwd(), 'data', 'platform.sqlite'));
const checklistFile = () => join(dataDir(), 'go-live-checklist.json');
// What the setup guide reads besides the environment: the agent's .env (Telegram session), whether the key file exists,
// and the tool settings files next to the project, checked for pasted secrets (only names and counts are returned).
function setupExtra() {
  const agentEnv = (() => { try { return agentModule<{ collectAgentConfig: (env: NodeJS.ProcessEnv) => Record<string, string> }>('modules/agent-config.js').collectAgentConfig(process.env); } catch { return {}; } })();
  const files = [[join(process.cwd(), '..', '.claude', 'settings.local.json'), '.claude/settings.local.json (proje kökü)'], [join(process.cwd(), '.claude', 'settings.local.json'), 'crewinjob-web/.claude/settings.local.json']]
    .flatMap(([file, label]) => { try { return [{ label, text: readFileSync(file, 'utf8') }]; } catch { return []; } });
  return { agentEnv, files, keyFile: { exists: existsSync(join(dataDir(), 'platform-credentials.key')), path: 'data/platform-credentials.key' } };
}
export async function GET(request: NextRequest) {
  if (!await operator('members.manage')) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const view = request.nextUrl.searchParams.get('view');
  // Setup guide: callback addresses are derived from the address this panel is opened from (the provider must send the
  // browser back to the same place).
  if (view === 'setup') return NextResponse.json(serverSetup(platformDatabase(), panelOrigin(request), process.env, Date.now(), setupExtra()), { headers });
  if (view === 'checklist') return NextResponse.json(goLiveChecklist(checklistFile()), { headers });
  if (view === 'funnel') {
    const days = Number(request.nextUrl.searchParams.get('days') || 90);
    return NextResponse.json(operatorFunnel(platformDatabase(), [30, 90, 365].includes(days) ? days : 90), { headers });
  }
  return NextResponse.json(operatorReadiness(platformDatabase()), { headers });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  const access = await operator('members.manage');
  if (!access) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const body = await request.json().catch(() => ({})) as { action?: unknown; id?: unknown; done?: unknown };
  if (body.action === 'probe' && body.id === 'gemini') return NextResponse.json(await probeGemini(), { headers });
  if (body.action === 'probe' && body.id === 'google') return NextResponse.json(await probeGoogle(), { headers });
  if (body.action === 'probe' && body.id === 'meta') return NextResponse.json(await probeMeta(), { headers });
  if (body.action === 'checklist') {
    try { return NextResponse.json(setChecklistItem(checklistFile(), body.id, body.done, access.subject), { headers }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Geçersiz işlem.' }, { status: 400, headers }); }
  }
  return NextResponse.json({ error: 'Geçersiz işlem.' }, { status: 400, headers });
}
