import type { Metadata } from 'next';
import ProspectAnalysisPage from '@/components/platform/ProspectAnalysisPage';
import { requestLang } from '@/lib/i18n/server';
import { pick } from '@/lib/i18n/shared';
// A shared mini analysis of a company's public site. The token lives in the URL fragment, which the browser never sends.
export async function generateMetadata(): Promise<Metadata> { const lang = await requestLang(); return { title: pick(lang, 'Kısa site analizi', 'Short site analysis'), robots: { index: false, follow: false }, referrer: 'no-referrer' }; }
export default async function Page() { return <ProspectAnalysisPage lang={await requestLang()} />; }
