'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import RyzevoUnsubscribe from '@/components/platform/RyzevoUnsubscribe';
import { LangToggle, useLang, useT } from '@/lib/lang';
import Msg from '@/components/Msg';

type State = 'loading' | 'success' | 'invalid' | 'missing';

export default function UnsubscribePage() {
  const [token,setToken]=useState<string|null>(null);
  useEffect(()=>{setToken(new URLSearchParams(window.location.search).get('token')?.trim()||'');},[]);
  if(token===null)return null;
  return /^rzv/i.test(token)?<RyzevoUnsubscribe token={token}/>:<LegacyUnsubscribePage/>;
}
function LegacyUnsubscribePage() {
  const { lang } = useLang(), t = useT();
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')?.trim();
    if (!token) {
      setState('missing');
      return;
    }

    fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(response => setState(response.ok ? 'success' : 'invalid'))
      .catch(() => setState('invalid'));
  }, []);

  const valid = state === 'success';
  const message = state === 'loading'
    ? t('İşleminiz gerçekleştiriliyor…', 'Processing your request…')
    : valid
      ? t('Aboneliğiniz iptal edildi', 'You have been unsubscribed')
      : t('Bu link geçersiz veya süresi dolmuş', 'This link is invalid or has expired');

  return (
    <main className="relative min-h-screen bg-slate-950 text-white flex items-center justify-center px-6" lang={lang}>
      <LangToggle className="absolute right-4 top-4 z-10 inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 text-[11px] font-bold tracking-[.04em] text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400" />
      <section className="w-full max-w-md text-center">
        <Image src="/crewin-logo.svg" alt="Crewin" width={170} height={46} className="mx-auto brightness-0 invert" priority />
        <div className="mt-8 border border-slate-700 bg-slate-900 px-6 py-8 shadow-xl">
          {state === 'loading' && <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" aria-hidden="true" />}
          {state !== 'loading' && <div className={`mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-full text-xl ${valid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`} aria-hidden="true">{valid ? '✓' : '!'}</div>}
          <h1 className="text-xl font-semibold"><Msg text={message}/></h1>
          {state === 'missing' && <p className="mt-3 text-sm text-slate-400">{t('E-posta içindeki bağlantıyı tekrar kullanmayı deneyin.', 'Try the link in the email again.')}</p>}
        </div>
      </section>
    </main>
  );
}
