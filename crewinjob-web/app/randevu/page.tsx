import type { Metadata } from 'next';
import BookingPage from '@/components/platform/BookingPage';
import { requestLang } from '@/lib/i18n/server';
import { pick } from '@/lib/i18n/shared';
import { isVoiceEnabled, voiceRegion } from '@/lib/platform/voice-features';
// A team's public booking page. The page key lives in the URL fragment.
export async function generateMetadata(): Promise<Metadata> { const lang = await requestLang(); return { title: pick(lang, 'Görüşme planla', 'Book a meeting'), robots: { index: false, follow: false }, referrer: 'no-referrer' }; }
// Voice features (off by default) add the assistant notice and call consents; off, the page is exactly as before.
export default async function Page() { return <BookingPage lang={await requestLang()} {...(isVoiceEnabled() ? { voice: { region: voiceRegion() } } : {})} />; }
