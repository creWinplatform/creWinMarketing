import type {Metadata} from 'next';
import IdentityFlow from '@/components/platform/IdentityFlow';
import {requestLang} from '@/lib/i18n/server';
import {pick} from '@/lib/i18n/shared';
export async function generateMetadata():Promise<Metadata>{const lang=await requestLang();return {title:pick(lang,'E-postanı doğrula','Verify your email'),robots:{index:false,follow:false},referrer:'no-referrer'};}
export default function Page(){return <IdentityFlow kind="verify"/>;}
