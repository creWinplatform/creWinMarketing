import type {Metadata} from 'next';
import PortfolioPage from '@/components/platform/PortfolioPage';
import {requestLang} from '@/lib/i18n/server';
import {pick} from '@/lib/i18n/shared';
// Every project the signed-in person belongs to. The middleware keeps it behind a session like the workspace.
export async function generateMetadata():Promise<Metadata>{const lang=await requestLang();return {title:pick(lang,'Tüm projeler','All projects'),robots:{index:false,follow:false}};}
export default async function Page(){return <PortfolioPage lang={await requestLang()}/>;}
