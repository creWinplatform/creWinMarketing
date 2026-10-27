import { NextRequest, NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/auth';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ConnectionJobs,settleUnauthorizedConnectionJob } from '@/lib/platform/connection-jobs';
import { pruneProductEvents } from '@/lib/platform/product-webhooks';
import { pruneEmailTokens } from '@/lib/platform/email-safety';
import { runEmailPilotJob } from '@/lib/platform/email-pilots';
import { EmailSendJobs } from '@/lib/platform/email-send-jobs';
import { ProjectMeasurements, scheduleMeasurements } from '@/lib/platform/measurements';
import { SocialPublications } from '@/lib/platform/social-publications';
import { PlatformIdentity } from '@/lib/platform/identity';
import { observeWorkerTick } from '@/lib/platform/worker-health';
import { MobileGrowth } from '@/lib/platform/mobile-store';
import { MobileDelivery,settleUnauthorizedMobileJob } from '@/lib/platform/mobile-delivery';
import { deliverNextCoachDigest } from '@/lib/platform/coach-digest';
import { deliverNextContractEmail } from '@/lib/platform/billing-contract';
import { advanceSeoScans } from '@/lib/platform/seo-operations';
import { evaluateDueAutomations } from '@/lib/platform/automations';
import { readDueMessagingSources } from '@/lib/platform/messaging-sources';
import { deliverWhatsAppBatches } from '@/lib/platform/whatsapp';
import { readDueInboxAccounts } from '@/lib/platform/social-inbox';
import { syncDueLinkResults } from '@/lib/platform/link-tracking';
export const dynamic = 'force-dynamic',
  maxDuration = 60;
export async function POST(request: NextRequest) {
  if (!hasValidCronSecret(request))
    return NextResponse.json(
      { error: 'Worker erişimi reddedildi.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const db = platformDatabase();
    const result = await observeWorkerTick(db, () => runTick(db));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Worker işlemi tamamlanamadı.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function runTick(db: ReturnType<typeof platformDatabase>) {
  const startedAt = Date.now();
  const pruned = pruneProductEvents(db);
  const expiredEmailTokens = pruneEmailTokens(db);
  const scheduledMeasurements = scheduleMeasurements(db, credentialEncryptionKey());
  const identity=new PlatformIdentity(db,credentialEncryptionKey());
  identity.prune();
  const rows = db
    .prepare(
      "SELECT id,actor_id,organization_id,project_id,job_type FROM platform_jobs WHERE job_type IN ('connection.verify','product.sync','email.rehearsal','email.pilot_send','measurement.sync','social.publish','mobile.message') AND (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<?))) AND (job_type<>'social.publish' OR EXISTS(SELECT 1 FROM platform_social_publications p WHERE p.job_id=platform_jobs.id AND p.scheduled_at<=? AND (p.next_check_at IS NULL OR p.next_check_at<=?))) AND (job_type<>'mobile.message' OR EXISTS(SELECT 1 FROM platform_mobile_messages m WHERE m.job_id=platform_jobs.id AND m.scheduled_at<=?)) ORDER BY created_at,id LIMIT 3",
    )
    .all(new Date().toISOString(),new Date().toISOString(),new Date().toISOString(),new Date().toISOString()) as {
    id: string;
    actor_id: string;
    organization_id: string;
    project_id: string;
    job_type: string;
  }[];
  let checked = 0,
    failed = 0;
  for (const row of rows) {
    if (Date.now() - startedAt > 25000) break;
    try {
      const scope={
        subject: row.actor_id,
        organizationId: row.organization_id,
        projectId: row.project_id,
      };
      if(row.job_type==='email.rehearsal')await runEmailPilotJob(db,scope,row.id,credentialEncryptionKey());
      else if(row.job_type==='email.pilot_send')await new EmailSendJobs(db,scope,credentialEncryptionKey()).process(row.id);
      else if(row.job_type==='measurement.sync')await new ProjectMeasurements(db,scope,credentialEncryptionKey()).process(row.id);
      else if(row.job_type==='social.publish')await new SocialPublications(db,scope,credentialEncryptionKey()).process(row.id);
      else if(row.job_type==='mobile.message'){const mobile=new MobileGrowth(db,scope,credentialEncryptionKey());if(settleUnauthorizedMobileJob(db,mobile,row.id)){failed++;continue;}await new MobileDelivery(mobile).process(row.id);}
      else if(settleUnauthorizedConnectionJob(db,scope,row.id)){failed++;continue;}
      else await new ConnectionJobs(db,scope).run(row.id, credentialEncryptionKey());
      checked++;
    } catch {
      failed++;
    }
  }
  const identityEmail=Date.now()-startedAt<25000?await identity.deliverNext():false;
  const coachDigest=Date.now()-startedAt<25000?await deliverNextCoachDigest(db).catch(()=>false):false;
  const contractEmail=Date.now()-startedAt<25000?await deliverNextContractEmail(db).catch(()=>false):false;
  // SEO scans whose tab was closed continue here, one page at a time.
  const seoPages=Date.now()-startedAt<20000?await advanceSeoScans(db).catch(()=>0):0;
  // Automation bookkeeping only (enrollments and exits); sending always waits for a person's approval.
  let automations=0;try{automations=evaluateDueAutomations(db,credentialEncryptionKey());}catch{automations=0;}
  // Channel posts wait about 24 hours on Telegram, so sources with automatic reading are read every 30 minutes.
  const messagingReads=Date.now()-startedAt<20000?await readDueMessagingSources(db,credentialEncryptionKey()).catch(()=>0):0;
  // Approved WhatsApp batches continue a few messages per tick; each message is re-checked before it goes.
  const whatsappBatches=Date.now()-startedAt<20000?await deliverWhatsAppBatches(db,credentialEncryptionKey()).catch(()=>0):0;
  // Inbox accounts with automatic reading are read every 30 minutes, as the person who turned it on.
  const inboxReads=Date.now()-startedAt<20000?await readDueInboxAccounts(db,credentialEncryptionKey()).catch(()=>0):0;
  // Tagged-link results are read from GA4 once a day per project, as the person who chose the property.
  const linkResults=Date.now()-startedAt<20000?await syncDueLinkResults(db,credentialEncryptionKey()).catch(()=>0):0;
  return { checked, failed, pruned, expiredEmailTokens, scheduledMeasurements, identityEmail, coachDigest, contractEmail, seoPages, automations, messagingReads, whatsappBatches, inboxReads, linkResults };
}
