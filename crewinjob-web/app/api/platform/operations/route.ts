import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectOperations } from '@/lib/platform/operations';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { ProjectMeasurements } from '@/lib/platform/measurements';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest) {
  try {
    const access = await getRyzevoAccess();
    if (!access)
      return NextResponse.json(
        { error: 'Proje oturumu gerekli.' },
        { status: 403 },
      );
    if (request.method !== 'GET' && !hasSameRequestOrigin(request))
      return NextResponse.json(
        { error: 'İstek kaynağı geçersiz.' },
        { status: 403 },
      );
    const operations = new ProjectOperations(platformDatabase(), {
      subject: access.subject,
      organizationId: access.identity.organizationId,
      projectId: access.identity.projectId,
    });
    const resource = request.nextUrl.searchParams.get('resource');
    if (request.method === 'GET') {
      if (resource === 'export') {
        const cell = (value: unknown) => {
          const raw = String(value ?? ''),
            safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? "'" + raw : raw;
          return `"${safe.replace(/"/g, '""')}"`;
        };
        const automatic = request.nextUrl.searchParams.get('mode') === 'automatic';
        const measured = automatic ? new ProjectMeasurements(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey()).workspace(request.nextUrl.searchParams.get('from') ?? undefined, request.nextUrl.searchParams.get('to') ?? undefined) : null;
        const rows = measured ? [
          ['goalId','stageIndex','provider','resource','metric','eventName','periodFrom','periodTo','timezone','value','status','fresh','checkedAt'],
          ...measured.bindings.map(item => [item.goalId,item.stageIndex,item.provider,item.latest ? item.latest.resource : item.resource,item.definition.metric,item.definition.eventName,measured.from,measured.to,item.latest?.timezone,item.latest?.value,item.latest?.resultStatus || 'pending',item.latest?.fresh || false,item.latest?.checkedAt]),
        ] : [
          ['goalId', 'stageIndex', 'value', 'observedAt', 'source', 'note'],
          ...operations
            .metrics()
            .map((item) => [
              item.goalId,
              item.stageIndex,
              item.value,
              item.observedAt,
              item.source,
              item.note,
            ]),
        ];
        const csv = rows
          .map((row) => row.map(cell).join(','))
          .join('\r\n');
        return new NextResponse('\uFEFF' + csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${automatic ? 'project-automatic-metrics' : 'project-metrics'}.csv"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }
      return NextResponse.json(operations.summary(), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const input = await request.json();
    if (request.method === 'DELETE') {
      if (resource === 'metrics') operations.removeMetric(input.id);
      else if (resource === 'tasks') operations.removeTask(input.id);
      else throw new MarketingStoreError('Geçersiz işlem.');
      return NextResponse.json({ ok: true });
    }
    if (resource === 'tasks')
      return NextResponse.json(operations.saveTask(input));
    if (resource === 'metrics')
      return NextResponse.json(operations.saveMetric(input), { status: 201 });
    throw new MarketingStoreError('Geçersiz işlem.');
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MarketingStoreError
            ? error.message
            : 'İstek tamamlanamadı.',
      },
      { status: error instanceof MarketingStoreError ? error.status : 400 },
    );
  }
}
export const GET = handle,
  POST = handle,
  DELETE = handle;
