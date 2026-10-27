import type {Metadata} from 'next';
import SharedReportPage from '@/components/platform/SharedReportPage';
import {requestLang} from '@/lib/i18n/server';
import {pick} from '@/lib/i18n/shared';
// A shared monthly report. The token lives in the URL fragment, which the browser never sends to the server.
export async function generateMetadata():Promise<Metadata>{const lang=await requestLang();return {title:pick(lang,'Aylık sonuç raporu','Monthly results report'),robots:{index:false,follow:false},referrer:'no-referrer'};}
export default async function Page(){return <SharedReportPage lang={await requestLang()}/>;}
