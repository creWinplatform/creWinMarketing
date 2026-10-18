import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type Api = {
  marketingIntegrationGet: (endpoint: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  marketingIntegrationConnectionGet: (endpoint: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function providerChannel(provider: string): string {
  const value = provider.toLowerCase();
  if (/mail|smtp|ses|sendgrid/.test(value)) return 'email';
  if (value.includes('whatsapp')) return 'whatsapp';
  if (value.includes('telegram')) return 'telegram';
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const api = agentModule<Api>('modules/api.js');
    const [catalogResult, connectionResult] = await Promise.allSettled([
      api.marketingIntegrationGet('GetAll', {
        channel: req.nextUrl.searchParams.get('channel') || undefined,
        activeOnly: true,
      }),
      api.marketingIntegrationConnectionGet('GetAll', {}),
    ]);
    if (catalogResult.status === 'rejected' && connectionResult.status === 'rejected') throw catalogResult.reason;
    const result = catalogResult.status === 'fulfilled' ? catalogResult.value : {};
    const connectionsResult = connectionResult.status === 'fulfilled' ? connectionResult.value : {};
    const raw = Array.isArray(result) ? result : Array.isArray(result.items) ? result.items : [];
    const rawConnections = Array.isArray(connectionsResult) ? connectionsResult : Array.isArray(connectionsResult.items) ? connectionsResult.items : [];
    const connections = rawConnections.map(value => value as Record<string, unknown>);
    const items = raw.map((value) => {
      const item = value as Record<string, unknown>;
      const connection = connections.find(candidate => String(candidate.integrationId ?? '') === String(item.id ?? ''));
      return {
        id: String(item.id ?? ''),
        name: String(item.name ?? item.integrationName ?? item.id ?? ''),
        channel: String(item.channel ?? '').toLowerCase(),
        provider: String(item.provider ?? ''),
        isActive: item.isActive !== false,
        isConfigured: item.isConfigured !== false || Boolean(connection),
        senderName: item.senderName == null ? null : String(item.senderName),
        senderAddressMasked: connection?.accountEmail == null
          ? item.senderAddressMasked == null ? null : String(item.senderAddressMasked)
          : String(connection.accountEmail),
        capabilities: item.capabilities && typeof item.capabilities === 'object' ? item.capabilities : {},
      };
    }).filter(item => item.id && item.isActive);
    for (const connection of connections) {
      const integrationId = String(connection.integrationId ?? connection.id ?? '');
      if (!integrationId || items.some(item => item.id === integrationId)) continue;
      const provider = String(connection.provider ?? '');
      items.push({
        id: integrationId,
        name: String(connection.accountName ?? provider ?? integrationId),
        channel: providerChannel(provider),
        provider,
        isActive: connection.isRevoked !== true,
        isConfigured: connection.isRevoked !== true,
        senderName: connection.accountName == null ? null : String(connection.accountName),
        senderAddressMasked: connection.accountEmail == null ? null : String(connection.accountEmail),
        capabilities: {},
      });
    }
    return NextResponse.json({ available: true, items, totalCount: items.length });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 404 || status === 405 || (error instanceof Error && /HTTP (404|405)/.test(error.message))) {
      return NextResponse.json({ available: false, reason: 'backend_not_ready', items: [], totalCount: 0 });
    }
    return NextResponse.json({ available: false, reason: status === 401 || status === 403 ? 'permission_denied' : 'backend_error', items: [], totalCount: 0 }, { status: status === 401 || status === 403 ? status : 502 });
  }
}
