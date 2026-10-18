import { NextRequest, NextResponse } from 'next/server';
import { auditPublicPage } from '@/lib/site-audit';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectOperations } from '@/lib/platform/operations';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import type {UsageReservation} from '@/lib/platform/plan-types';
import { compassSiteReceipt } from '@/lib/platform/guidance';
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  let operations: ProjectOperations | undefined, reservation: UsageReservation | undefined;
  try {
    if (!hasSameRequestOrigin(request))
      return NextResponse.json(
        { error: 'İstek kaynağı geçersiz.' },
        { status: 403 },
      );
    const access = await getPlatformAccess('content.write');
    if (!access || access.identity.mode !== 'platform')
      return NextResponse.json(
        { error: 'Proje erişimi reddedildi.' },
        { status: 403 },
      );
    const input = await request.json();
    if (typeof input.url !== 'string' || input.url.length > 2048)
      throw new MarketingStoreError('Geçerli bir URL girin.');
    const workspace = access.repository.workspace(
      access.subject,
      access.identity.organizationId,
      access.identity.projectId,
    )!;
    if (new URL(input.url).origin !== new URL(workspace.project.website).origin)
      throw new MarketingStoreError(
        'Yalnız projenizin web sitesi denetlenebilir.',
      );
    operations = new ProjectOperations(platformDatabase(), {
      subject: access.subject,
      organizationId: access.identity.organizationId,
      projectId: access.identity.projectId,
    });
    reservation = operations.reserveAi('audits');
    const result = await auditPublicPage(input.url);
    if (
      !access.repository.can(
        access.subject,
        access.identity.organizationId,
        access.identity.projectId,
        'read',
      )
    )
      throw new MarketingStoreError('Proje erişimi değişti.', 403);
    platformDatabase().transaction(()=>{
      operations!.completeAi(reservation!);
      const at=new Date().toISOString(),receipt=compassSiteReceipt(workspace.project.website),insert=platformDatabase().prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)');
      insert.run(access.subject,access.identity.organizationId,access.identity.projectId,receipt,at);
      if(!result.findings.length)insert.run(access.subject,access.identity.organizationId,access.identity.projectId,receipt+':clean',at);
    })();
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (operations && reservation){try{operations.refundAi(reservation);}catch{console.error('platform_usage_release_failed');}}
    return NextResponse.json(
      {
        error:
          error instanceof MarketingStoreError
            ? error.message
            : 'Public HTML denetimi tamamlanamadı. URL ve bağlantıyı kontrol edin.',
      },
      { status: error instanceof MarketingStoreError ? error.status : 400 },
    );
  }
}
