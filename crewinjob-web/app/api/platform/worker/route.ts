import { NextRequest, NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/auth';
import { cachedAllData, cachedBreakdown } from '@/lib/agent-bridge';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ConnectionJobs,settleUnauthorizedConnectionJob } from '@/lib/platform/connection-jobs';
import { pruneProductEvents } from '@/lib/platform/product-webhooks';
import { refreshDueCompetitors,refreshDueKeywordRanks } from '@/lib/platform/mobile-aso';
import { syncDueReviews } from '@/lib/platform/mobile-reviews';
import { refreshDueAdSpend } from '@/lib/platform/ad-spend-refresh';
import { refreshDueCreativeStats } from '@/lib/platform/ad-creatives';
import { deliverNextWeeklySummary } from '@/lib/platform/weekly-summary';
import { pruneAttribution } from '@/lib/platform/attribution';
import { deliverIysOutbox, pullIysChanges } from '@/lib/platform/iys';
import { crewinIysEmailBackfill } from '@/lib/crewin-iys-email';
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
import { advanceSeoScans, runSeoSchedules } from '@/lib/platform/seo-operations';
import { runAiVisibilityChecks } from '@/lib/platform/ai-visibility';
import { coachGemini, visibilityGemini } from '../coach/shared';
import { deliverNextWeeklyPack } from '@/lib/platform/coach-weekly-pack';
import { refreshDueCompetitorSites } from '@/lib/platform/competitor-sites';
import { evaluateDueAutomations } from '@/lib/platform/automations';
import { readDueMessagingSources } from '@/lib/platform/messaging-sources';
import { deliverWhatsAppBatches } from '@/lib/platform/whatsapp';
import { readDueInboxAccounts } from '@/lib/platform/social-inbox';
import { syncDueLinkResults } from '@/lib/platform/link-tracking';
import { deliverNextAlertEmail } from '@/lib/platform/team-alerts';
import { deliverDuePushes } from '@/lib/platform/web-push';
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
  // Keeps the Crewin figures warm for the panel (shown from cache, refreshed in the background); not awaited, and a
  // missing Crewin agent or backend is simply skipped.
  void cachedAllData().catch(() => {}); void cachedBreakdown().catch(() => {});
  const pruned = { ...await pruneProductEvents(db), attribution: await pruneAttribution(db) };
  const expiredEmailTokens = await pruneEmailTokens(db);
  const scheduledMeasurements = await scheduleMeasurements(db, credentialEncryptionKey());
  const identity=new PlatformIdentity(db,credentialEncryptionKey());
  await identity.prune();
  const rows = await db
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
      else if(row.job_type==='mobile.message'){const mobile=new MobileGrowth(db,scope,credentialEncryptionKey());if(await settleUnauthorizedMobileJob(db,mobile,row.id)){failed++;continue;}await new MobileDelivery(mobile).process(row.id);}
      else if(await settleUnauthorizedConnectionJob(db,scope,row.id)){failed++;continue;}
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
  // Scheduled scans start here (as the member who set them) and the weekly Search Console totals are read.
  const seoSchedules=Date.now()-startedAt<20000?await runSeoSchedules(db,credentialEncryptionKey()).catch(()=>({started:0,checked:0})):{started:0,checked:0};
  const seoPages=Date.now()-startedAt<20000?await advanceSeoScans(db).catch(()=>0):0;
  // Weekly AI search visibility checks (opt-in; one AI credit per question, as the member who turned them on).
  const aiVisibility=Date.now()-startedAt<15000?await runAiVisibilityChecks(db,visibilityGemini()).catch(()=>0):0;
  // Automation bookkeeping only (enrollments and exits); sending always waits for a person's approval.
  let automations=0;try{automations=await evaluateDueAutomations(db,credentialEncryptionKey());}catch{automations=0;}
  // Channel posts wait about 24 hours on Telegram, so sources with automatic reading are read every 30 minutes.
  const messagingReads=Date.now()-startedAt<20000?await readDueMessagingSources(db,credentialEncryptionKey()).catch(()=>0):0;
  // Approved WhatsApp batches continue a few messages per tick; each message is re-checked before it goes.
  const whatsappBatches=Date.now()-startedAt<20000?await deliverWhatsAppBatches(db,credentialEncryptionKey()).catch(()=>0):0;
  // Inbox accounts with automatic reading are read every 30 minutes, as the person who turned it on.
  const inboxReads=Date.now()-startedAt<20000?await readDueInboxAccounts(db,credentialEncryptionKey()).catch(()=>0):0;
  // Tagged-link results are read from GA4 once a day per project, as the person who chose the property.
  const linkResults=Date.now()-startedAt<20000?await syncDueLinkResults(db,credentialEncryptionKey()).catch(()=>0):0;
  // Opted-in members hear about new deadline-sensitive records by email; one subscriber is looked at per tick.
  const alertEmail=Date.now()-startedAt<25000?await deliverNextAlertEmail(db).catch(()=>false):false;
  // The Monday summary for members who opted in, one per tick.
  const weeklySummary=Date.now()-startedAt<25000?await deliverNextWeeklySummary(db).catch(()=>false):false;
  // The Monday pack of one project per tick (drafts only; nothing is published).
  // One competitor website a tick, once a week each (public pages only).
  const competitorSites=Date.now()-startedAt<20000?await refreshDueCompetitorSites(db).then(result=>result?1:0).catch(()=>0):0;
  const weeklyPack=Date.now()-startedAt<20000?await deliverNextWeeklyPack(db,coachGemini(1500)).then(result=>result?result.drafts:0).catch(()=>0):0;
  // Phone notifications carry no data: a fixed notice that something new needs the person, at most every 30 minutes.
  const pushes=Date.now()-startedAt<25000?await deliverDuePushes(db,credentialEncryptionKey()).catch(()=>0):0;
  // İYS: consents and opt-outs are reported a few per tick; the change feed is read every 30 minutes per project.
  const iysOutbox=Date.now()-startedAt<20000?await deliverIysOutbox(db,credentialEncryptionKey()).catch(()=>({sent:0,failed:0})):{sent:0,failed:0};
  const iysChanges=Date.now()-startedAt<20000?await pullIysChanges(db,credentialEncryptionKey()).catch(()=>({projects:0,changes:0})):{projects:0,changes:0};
  // Crewin email: recipients whose İYS status is unknown are asked about, 50 per tick (lib/crewin-iys-email.ts).
  const crewinIysEmail=Date.now()-startedAt<20000?await crewinIysEmailBackfill(db,credentialEncryptionKey()).catch(()=>({checked:0})):{checked:0};
  // ASO: tracked App Store search terms are checked once a day, five per tick (Apple's public search API).
  const keywordRanks=Date.now()-startedAt<20000?await refreshDueKeywordRanks(db).catch(()=>0):0;
  // Competitor apps: their public store details are read once a day, five per tick.
  const competitors=Date.now()-startedAt<20000?await refreshDueCompetitors(db).catch(()=>0):0;
  // Store reviews: one connected store per tick, once a day each, as the person who set up the connection.
  const storeReviews=Date.now()-startedAt<20000?await syncDueReviews(db,credentialEncryptionKey()).catch(()=>0):0;
  // Ad spend: one running plan per tick is read from its provider every 6 hours, for the spend warnings.
  const adSpend=Date.now()-startedAt<20000?await refreshDueAdSpend(db,credentialEncryptionKey()).catch(()=>0):0;
  // Ad image and video figures: one plan per tick, once a day, for the comparison and the fatigue warning.
  const creativeStats=Date.now()-startedAt<20000?await refreshDueCreativeStats(db,credentialEncryptionKey()).catch(()=>0):0;
  return { checked, failed, pruned, expiredEmailTokens, scheduledMeasurements, identityEmail, coachDigest, contractEmail, seoPages, seoSchedules, aiVisibility, automations, messagingReads, whatsappBatches, inboxReads, linkResults, alertEmail, pushes, iysOutbox, iysChanges, crewinIysEmail, keywordRanks, competitors, storeReviews, adSpend, creativeStats, weeklySummary, weeklyPack, competitorSites };
}
