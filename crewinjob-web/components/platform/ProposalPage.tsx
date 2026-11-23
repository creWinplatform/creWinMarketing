'use client';
import { useEffect, useState } from 'react';
import { CalendarCheck, Printer } from 'lucide-react';
import type { PublicProposal } from '@/lib/platform/prospect-workflow-types';

// A shared proposal in the sender's brand, opened with the token from the URL fragment; printable (or saved as PDF
// from the browser's print dialog). A team preview (preview=1) is not counted as a view.
export default function ProposalPage({ lang }: { lang: 'tr' | 'en' }) {
  const [data, setData] = useState<PublicProposal | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1)), token = params.get('token') || '', controller = new AbortController();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setFailed(true); return; }
    fetch('/api/proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, preview: params.get('preview') === '1' }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => { if (!response.ok) throw new Error(); setData(await response.json() as PublicProposal); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const tr = (data?.language || lang) === 'tr', t = (a: string, b: string) => tr ? a : b;
  if (failed) return <main className="analysis-page"><p role="alert" className="analysis-card">{t('Bu teklif bağlantısı geçersiz, süresi dolmuş veya kapatılmış.', 'This proposal link is invalid, has expired or was turned off.')}</p></main>;
  if (!data) return <main className="analysis-page"><p role="status" className="analysis-card">{t('Teklif yükleniyor…', 'Loading the proposal…')}</p></main>;
  const c = data.content, list = (items: string[]) => items.length ? <ul className="proposal-list">{items.map(item => <li key={item}>{item}</li>)}</ul> : null;
  return <main className="analysis-page proposal-page" style={{ ['--analysis-primary' as string]: data.sender.primary, ['--analysis-accent' as string]: data.sender.accent }}>
    <header className="analysis-head">{data.sender.logo ? <img src={data.sender.logo} alt={data.sender.name} className="analysis-logo" /> : <strong className="analysis-sender">{data.sender.name}</strong>}<span>{new Date(data.createdAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></header>
    <article className="analysis-card">
      <p className="analysis-eyebrow">{t(`${data.company} için teklif`, `Proposal for ${data.company}`)}</p><h1>{c.title}</h1>
      <p className="proposal-text">{c.summary}</p>
      {c.needs.length > 0 && <><h2>{t('İhtiyaçlar', 'Needs')}</h2>{list(c.needs)}</>}
      <h2>{t('Önerimiz', 'Our proposal')}</h2><p className="proposal-text">{c.solution}</p>
      {c.scope.length > 0 && <><h2>{t('Kapsam', 'Scope')}</h2>{list(c.scope)}</>}
      {c.timeline && <><h2>{t('Zaman planı', 'Timeline')}</h2><p className="proposal-text">{c.timeline}</p></>}
      {c.price && <><h2>{t('Fiyat', 'Price')}</h2><p className="proposal-price">{c.price}</p></>}
      {c.nextStep && <><h2>{t('Sonraki adım', 'Next step')}</h2><p className="proposal-text">{c.nextStep}</p></>}
    </article>
    <div className="proposal-actions">{data.booking && <a className="booking-button" href={data.booking}><CalendarCheck size={16} aria-hidden="true" />{t('Görüşme planla', 'Book a meeting')}</a>}
      <button type="button" className="booking-button is-quiet" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />{t('Yazdır / PDF', 'Print / PDF')}</button></div>
    <footer className="analysis-foot"><p><strong>{data.sender.name}</strong> · <a href={data.sender.website} target="_blank" rel="noreferrer">{data.sender.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></p></footer>
  </main>;
}
