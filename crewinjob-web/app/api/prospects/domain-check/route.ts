import { NextRequest, NextResponse } from 'next/server';
import { checkEmailDomains } from '@/lib/email-domain-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/prospects/domain-check { emails: string[] } → can each address's domain receive email (DNS MX)?
// Signed-in panel users only (middleware); DNS lookups only, nothing is sent.
export async function POST(req: NextRequest) {
  let emails: unknown;
  try { emails = (await req.json() as { emails?: unknown }).emails; } catch { emails = null; }
  if (!Array.isArray(emails) || emails.length > 200 || emails.some(item => typeof item !== 'string' || item.length > 320)) {
    return NextResponse.json({ error: 'Geçersiz istek: en fazla 200 e-posta adresi gönderin.' }, { status: 400 });
  }
  return NextResponse.json({ results: await checkEmailDomains(emails as string[]) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
