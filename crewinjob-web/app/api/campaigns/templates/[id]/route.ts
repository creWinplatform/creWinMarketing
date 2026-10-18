import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type Api = {
  marketingTemplateGet: (endpoint: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const item = await agentModule<Api>('modules/api.js').marketingTemplateGet('Get', { id: params.id });
    const value = item && typeof item === 'object' ? item : {};
    return NextResponse.json({
      available: true,
      item: {
        id: String(value.id ?? params.id),
        name: String(value.name ?? value.templateName ?? params.id),
        channel: String(value.channel ?? '').toLowerCase(),
        subject: value.subject == null ? null : String(value.subject),
        content: value.content == null ? '' : String(value.content),
        language: value.language == null ? null : String(value.language),
      },
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 404 || status === 405 || (error instanceof Error && /HTTP (404|405)/.test(error.message))) {
      return NextResponse.json({ available: false, reason: 'backend_not_ready' }, { status: 404 });
    }
    return NextResponse.json({ available: false, reason: status === 401 || status === 403 ? 'permission_denied' : 'backend_error' }, { status: status === 401 || status === 403 ? status : 502 });
  }
}
