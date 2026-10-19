import type {Metadata} from 'next';
import {requestLang} from '@/lib/i18n/server';
import {pick} from '@/lib/i18n/shared';
export async function generateMetadata():Promise<Metadata>{const lang=await requestLang();return {title:pick(lang,'Pilot daveti','Pilot invitation'),robots:{index:false,follow:false},referrer:'no-referrer'};}
export default function JoinLayout({children}:{children:React.ReactNode}){return children;}
