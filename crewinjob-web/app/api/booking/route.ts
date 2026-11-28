import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { bookMeeting, publicBooking } from '@/lib/platform/prospect-workflow';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { isVoiceEnabled } from '@/lib/platform/voice-features';
import { bookingCallConsents, bookingVoiceAction, recordBookingCallConsents } from '@/lib/platform/voice-booking';
export const dynamic = 'force-dynamic';
// The team's public booking page: free times and booking. The page key comes from the URL fragment; a closed or
// unknown page gets the same answer. Bookings are capped per page and day (the page is shared with many visitors, so
// there is no per-link view limit).
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
export async function POST(request: NextRequest) {
  if (!request.headers.get('origin') || !hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  try {
    const input = await readAuthenticationJson(request) as Record<string, unknown> | null, db = platformDatabase(), key = typeof input?.key === 'string' ? input.key : '';
    if (!input || !key) throw new MarketingStoreError('Bu randevu sayfası kapalı.', 404);
    // Voice features (off by default): the assistant's consent and the optional call consents of the form. With them off
    // none of this runs and the page answers exactly as before.
    const voice = isVoiceEnabled();
    if (voice && typeof input.action === 'string' && ['voice_consent', 'voice_withdraw', 'voice_status'].includes(input.action)) return NextResponse.json(await bookingVoiceAction(db, input), { headers });
    if (input.action === 'book') {
      const calls = voice ? bookingCallConsents(input) : null, booked = await bookMeeting(db, key, input, credentialEncryptionKey());
      // The booking stands even if the call consent cannot be written; the page then says it was not saved.
      if (calls) try { await recordBookingCallConsents(db, key, typeof input.email === 'string' ? input.email.trim().toLowerCase() : '', input.lang, calls, credentialEncryptionKey()); }
      catch { return NextResponse.json({ ...booked, callConsentSaved: false }, { headers }); }
      return NextResponse.json(booked, { headers });
    }
    const page = await publicBooking(db, key); if (!page) throw new MarketingStoreError('Bu randevu sayfası kapalı.', 404);
    return NextResponse.json(page, { headers });
  } catch (error) {
    const known = error instanceof MarketingStoreError;
    return NextResponse.json({ error: known ? error.message : 'Bu randevu sayfası kapalı.' }, { status: known ? error.status : 404, headers });
  }
}
