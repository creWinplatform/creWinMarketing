import type { Metadata } from 'next';
import ProposalPage from '@/components/platform/ProposalPage';
import { requestLang } from '@/lib/i18n/server';
import { pick } from '@/lib/i18n/shared';
// A shared proposal. The token lives in the URL fragment, which the browser never sends.
export async function generateMetadata(): Promise<Metadata> { const lang = await requestLang(); return { title: pick(lang, 'Teklif', 'Proposal'), robots: { index: false, follow: false }, referrer: 'no-referrer' }; }
export default async function Page() { return <ProposalPage lang={await requestLang()} />; }
