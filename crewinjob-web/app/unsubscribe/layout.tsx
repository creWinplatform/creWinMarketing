import type {Metadata} from 'next';
import {requestLang} from '@/lib/i18n/server';
import {pick} from '@/lib/i18n/shared';
export async function generateMetadata():Promise<Metadata>{const lang=await requestLang();return {title:pick(lang,'Abonelikten çık','Unsubscribe'),robots:{index:false,follow:false},referrer:'no-referrer'};}
export default function UnsubscribeLayout({children}:{children:React.ReactNode}){return children;}
