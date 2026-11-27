import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { receiveManagedSesNotification } from '@/lib/platform/outreach-inbound';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
export const dynamic = 'force-dynamic', runtime = 'nodejs', maxDuration = 30;
// Managed sales service, Amazon SES through SNS: delivery, bounce and spam report events, and received replies.
// The topic is PLATFORM_MANAGED_SES_TOPIC_ARN; every notification's signature is checked.
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  try {
    const bytes = await readBoundedBodyBytes(request, 262144), payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return NextResponse.json(await receiveManagedSesNotification(platformDatabase(), credentialEncryptionKey(), payload), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'SNS bildirimi doğrulanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 400, headers });
  }
}
