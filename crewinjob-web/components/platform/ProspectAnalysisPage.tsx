'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react';
import type { ProspectAnalysis } from '@/lib/platform/prospect-finder-types';

// A company's short site analysis, opened with the token from the URL fragment. It is shown in the sender's brand
// colours and language; a team preview (preview=1 in the fragment) is not counted as a view.
export default function ProspectAnalysisPage({ lang }: { lang: 'tr' | 'en' }) {
  const [data, setData] = useState<ProspectAnalysis | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1)), token = params.get('token') || '', controller = new AbortController();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setFailed(true); return; }
    fetch('/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, preview: params.get('preview') === '1' }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => { if (!response.ok) throw new Error(); setData(await response.json() as ProspectAnalysis); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const tr = (data?.language || lang) === 'tr', t = (a: string, b: string) => tr ? a : b;
  const day = (value: string) => new Date(value).toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const host = (value: string) => value.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (failed) return <main className="analysis-page"><p role="alert" className="analysis-card">{t('Bu analiz bağlantısı geçersiz, süresi dolmuş veya kapatılmış.', 'This analysis link is invalid, has expired or was turned off.')}</p></main>;
  if (!data) return <main className="analysis-page"><p role="status" className="analysis-card">{t('Analiz yükleniyor…', 'Loading the analysis…')}</p></main>;
  const missing = data.findings.filter(item => !item.present), present = data.findings.filter(item => item.present);
  return <main className="analysis-page" style={{ ['--analysis-primary' as string]: data.sender.primary, ['--analysis-accent' as string]: data.sender.accent }}>
    <header className="analysis-head">
      {data.sender.logo ? <img src={data.sender.logo} alt={data.sender.name} className="analysis-logo" /> : <strong className="analysis-sender">{data.sender.name}</strong>}
      {data.sender.tagline && <span>{data.sender.tagline}</span>}
    </header>
    <section className="analysis-card">
      <p className="analysis-eyebrow">{t('Kısa site analizi', 'Short site analysis')}</p>
      <h1>{data.company}</h1>
      <a href={data.website} target="_blank" rel="noreferrer noopener" className="analysis-site">{host(data.website)}<ExternalLink size={13} aria-hidden="true" /></a>
      <p className="analysis-note">{t(`Bu analiz ${day(data.scannedAt)} tarihinde sitenizin herkese açık ana sayfası otomatik olarak okunarak hazırlandı. Eksik görünen bir şey başka bir sayfada olabilir.`, `This analysis was prepared automatically on ${day(data.scannedAt)} by reading your site’s public home page. Something that looks missing may be on another page.`)}</p>
      {missing.length > 0 && <><h2>{t('Geliştirilebilecekler', 'Room to improve')}</h2>
        <ul className="analysis-list">{missing.map(item => <li key={item.key}><CircleAlert size={18} aria-hidden="true" className="analysis-icon-miss" /><span>{item.text}</span></li>)}</ul></>}
      {present.length > 0 && <><h2>{t('İyi durumda olanlar', 'Already in place')}</h2>
        <ul className="analysis-list">{present.map(item => <li key={item.key}><CheckCircle2 size={18} aria-hidden="true" className="analysis-icon-ok" /><span>{item.text}</span></li>)}</ul></>}
    </section>
    <footer className="analysis-foot">
      <p>{t(`Hazırlayan: ${data.sender.name}`, `Prepared by ${data.sender.name}`)} · <a href={data.sender.website} target="_blank" rel="noreferrer noopener">{host(data.sender.website)}</a></p>
      <p className="analysis-muted">{t(`Bağlantı ${day(data.expiresAt)} tarihine kadar geçerlidir. Ryzevo ile hazırlandı.`, `This link is valid until ${day(data.expiresAt)}. Prepared with Ryzevo.`)}</p>
    </footer>
  </main>;
}
