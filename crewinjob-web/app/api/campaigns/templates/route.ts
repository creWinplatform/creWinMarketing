import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type Api = {
  marketingTemplateGet: (endpoint: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export async function GET(req: NextRequest) {
  try {
    const result = await agentModule<Api>('modules/api.js').marketingTemplateGet('GetAll', {
      channel: req.nextUrl.searchParams.get('channel') || undefined,
      isActive: true,
      keyword: req.nextUrl.searchParams.get('keyword') || undefined,
      maxResultCount: Number(req.nextUrl.searchParams.get('maxResultCount') || 100),
      skipCount: Number(req.nextUrl.searchParams.get('skipCount') || 0),
    });
    const raw = Array.isArray(result) ? result : Array.isArray(result.items) ? result.items : [];
    const items = raw.map((value) => {
      const item = value as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        name: String(item.name ?? item.templateName ?? item.id ?? ''),
        channel: String(item.channel ?? '').toLowerCase(),
        subject: item.subject == null ? null : String(item.subject),
        language: item.language == null ? null : String(item.language),
        isActive: item.isActive !== false,
      };
    }).filter(item => item.id && item.isActive);
    return NextResponse.json({ available: true, items, totalCount: Number(result.totalCount ?? items.length) });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 404 || status === 405 || (error instanceof Error && /HTTP (404|405)/.test(error.message))) {
      return NextResponse.json({ available: false, reason: 'backend_not_ready', items: [], totalCount: 0 });
    }
    return NextResponse.json({ available: false, reason: status === 401 || status === 403 ? 'permission_denied' : 'backend_error', items: [], totalCount: 0 }, { status: status === 401 || status === 403 ? status : 502 });
  }
}
