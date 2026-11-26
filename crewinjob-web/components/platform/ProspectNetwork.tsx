'use client';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Building2, Check, Copy, ExternalLink, FileUp, Loader2, Search, Sparkles, Trash2, UserCheck, Users, X } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import Msg from '@/components/Msg';
import { STAGE_LABELS, type PipelineStage } from '@/lib/platform/prospect-outreach-types';
import type { NetworkContact, NetworkSnapshot } from '@/lib/platform/prospect-network-types';

const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };
const call = async <T,>(body: Record<string, unknown>) => await projectRequest<T>('/api/platform/prospects/network', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
// Splits a LinkedIn export into parts under the request limit; each part repeats the header row.
function parts(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/), start = lines.findIndex(line => /first name|ad[ıi]?\b/i.test(line) && /company|şirket|firma/i.test(line));
  if (start < 0) return [text];
  const header = lines[start], out: string[] = []; let chunk: string[] = [];
  for (const line of lines.slice(start + 1)) { if (!line.trim()) continue; chunk.push(line); if (chunk.join('\n').length > 60000) { out.push([header, ...chunk].join('\n')); chunk = []; } }
  if (chunk.length) out.push([header, ...chunk].join('\n'));
  return out;
}

// Warm introductions: who the team knows at the companies it wants to reach, and companies in its own network.
export default function ProspectNetworkPanel({ tr, onChanged }: { tr: boolean; onChanged: () => void }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [data, setData] = useState<NetworkSnapshot | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ contact: string; prospect: string | null; text: string } | null>(null), [copied, setCopied] = useState(false), [site, setSite] = useState<Record<string, string>>({});
  const load = useCallback(() => { projectRequest<NetworkSnapshot>('/api/platform/prospects/network').then(setData).catch(reason => setError(reason instanceof Error ? reason.message : '')); }, []);
  useEffect(() => { load(); }, [load]);
  const run = async <T,>(key: string, body: Record<string, unknown>, done?: (value: T) => void) => { if (busy) return; setBusy(key); setError(''); setNotice('');
    try { const value = await call<T>(body); if (done) done(value); else setData(value as unknown as NetworkSnapshot); return value; } catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); } finally { setBusy(''); } };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy) return;
    if (file.size > 3_000_000) { setError(t('Dosya çok büyük (en çok 3 MB).', 'The file is too large (at most 3 MB).')); return; }
    const chunks = parts(await file.text()); setBusy('import'); setError(''); setNotice(''); let added = 0, updated = 0;
    try { for (let index = 0; index < chunks.length; index++) { const value = await call<{ added: number; updated: number; snapshot: NetworkSnapshot }>({ action: 'import', csv: chunks[index], part: index }); added += value.added; updated += value.updated; setData(value.snapshot); }
      setNotice(t(`${added} tanıdık eklendi, ${updated} güncellendi.`, `${added} connections added, ${updated} updated.`)); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('Yükleme tamamlanamadı.', 'The upload failed.')); } finally { setBusy(''); }
  };
  const draft = (contact: NetworkContact, prospect: string | null) => void run<{ text: string }>(`draft-${contact.id}`, { action: 'draft', contactId: contact.id, prospectId: prospect, mode: data?.aiConfigured ? undefined : 'template' }, value => setMessage({ contact: contact.id, prospect, text: value.text }));
  if (!data) return error ? <p className="studio-error" role="alert"><Msg text={error} /></p> : <div className="studio-skeleton" role="status">{t('Tanıdıklar yükleniyor…', 'Loading connections…')}</div>;
  const person = (contact: NetworkContact, prospect: string | null) => <div className="network-person">
    <div><strong>{contact.name}</strong>{contact.decisionMaker && <span className="coach-state done">{t('karar verici olabilir', 'may decide')}</span>}<br /><span className="coach-muted">{contact.position}{contact.position && ' · '}{contact.company}</span>
      {contact.state !== 'new' && <span className="coach-muted"> · {contact.state === 'asked' ? t('yazıldı', 'asked') : contact.state === 'helped' ? t('yardım etti', 'helped') : t('ilgisiz', 'not relevant')}</span>}</div>
    {data.canWrite && <div className="coach-action-buttons">
      <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => draft(contact, prospect)}>{busy === `draft-${contact.id}` ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{t('Mesaj hazırla', 'Write a message')}</button>
      {contact.url && <a className="studio-text-button" href={contact.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />LinkedIn</a>}
      {contact.state !== 'helped' && contact.state !== 'new' && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void run('mark', { action: 'mark', contactId: contact.id, state: 'helped' })}><UserCheck size={14} />{t('Yardım etti', 'Helped')}</button>}
      {contact.state === 'new' && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void run('mark', { action: 'mark', contactId: contact.id, state: 'not_relevant' })}><X size={14} />{t('İlgisiz', 'Not relevant')}</button>}
    </div>}
    {message?.contact === contact.id && <div className="sales-copy">
      <textarea rows={4} value={message.text} onChange={event => setMessage({ ...message, text: event.target.value })} aria-label={t('Mesaj', 'Message')} />
      <div className="coach-action-buttons"><button type="button" className="studio-secondary" onClick={() => void copyText(message.text).then(ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('Kopyala', 'Copy')}</button>
        <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void run('mark', { action: 'mark', contactId: contact.id, state: 'asked', prospectId: message.prospect }).then(() => { setMessage(null); onChanged(); })}><Check size={14} />{t('Gönderdim', 'I sent it')}</button></div>
      <p className="coach-muted">{t('Mesajı LinkedIn’den kendiniz gönderin; Ryzevo göndermez.', 'Send it yourself on LinkedIn; Ryzevo does not send it.')}</p></div>}
  </div>;
  return <section className="network-panel">
    <div className="studio-band network-intro"><h2><Users size={16} aria-hidden="true" />{t('Tanıdıklarınız', 'Your connections')}</h2>
      <p className="coach-muted">{t('İlk müşteriler çoğu zaman tanıdıklardan gelir. LinkedIn bağlantılarınızı yükleyin; hedef firmalarınızda tanıdığınız kişileri ve ağınızdaki firmaları gösterelim. Mesajları siz gönderirsiniz.', 'First customers usually come from people you know. Upload your LinkedIn connections; we show who you know at your target companies and which companies are in your network. You send the messages.')}</p>
      {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}{notice && <p className="coach-note" role="status">{notice}</p>}
      {!data.termsAccepted ? <p className="studio-note">{t('Önce proje sahibi “Firma bul → Gelişmiş kaynaklar → Liste yükle”deki sorumluluk metnini kabul etmeli.', 'The project owner first accepts the responsibility text under “Find companies → Advanced sources → Upload a list”.')}</p>
        : data.canWrite && <div className="network-import">
          <label className="studio-secondary network-file"><FileUp size={15} />{busy === 'import' ? t('Yükleniyor…', 'Uploading…') : data.total ? t('Listeyi güncelle', 'Update the list') : t('Connections.csv yükle', 'Upload Connections.csv')}<input type="file" accept=".csv,text/csv" onChange={event => void upload(event)} disabled={Boolean(busy)} /></label>
          <details><summary className="coach-muted">{t('Dosyayı LinkedIn’den nasıl indiririm?', 'How do I download it from LinkedIn?')}</summary>
            <ol className="network-steps"><li>{t('LinkedIn’de sağ üstte “Ben” → “Ayarlar ve Gizlilik”.', 'On LinkedIn, top right “Me” → “Settings & Privacy”.')}</li><li>{t('“Veri gizliliği” → “Verilerinizin bir kopyasını alın”.', '“Data privacy” → “Get a copy of your data”.')}</li>
              <li>{t('“Bağlantılar”ı seçip “Arşiv iste”ye basın; birkaç dakika içinde e-postayla gelir.', 'Choose “Connections” and press “Request archive”; it arrives by email within minutes.')}</li><li>{t('İndirdiğiniz dosyadaki Connections.csv’yi buraya yükleyin.', 'Upload Connections.csv from the download here.')}</li></ol></details>
          {data.total > 0 && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Tanıdık listesinin tamamı silinsin mi?', 'Delete the whole connection list?'))) void run('clear', { action: 'clear' }); }}><Trash2 size={14} />{t('Listeyi sil', 'Delete the list')}</button>}
        </div>}
      {data.total > 0 && <p className="coach-muted">{t(`${data.total} tanıdık · ${data.asked} kişiye yazıldı`, `${data.total} connections · ${data.asked} messaged`)}{data.importedAt && ` · ${t('son yükleme', 'last upload')} ${new Date(data.importedAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB')}`}</p>}
    </div>
    {data.total > 0 && <>
      <div className="studio-band"><h2 className="network-title"><UserCheck size={15} aria-hidden="true" />{t(`Hedef firmalarınızda tanıdıklarınız (${data.matches.length})`, `People you know at your target companies (${data.matches.length})`)}</h2>
        {data.matches.length ? <ul className="network-list">{data.matches.map(match => <li key={match.contact.id}>{person(match.contact, match.prospects[0]?.id || null)}
          <p className="coach-muted">{t('Hedef', 'Target')}: {match.prospects.map(item => `${item.company} (${STAGE_LABELS[item.stage as PipelineStage]?.[idx] || item.stage})`).join(', ')}</p></li>)}</ul>
          : <p className="coach-muted">{t('Listedeki firmalarda tanıdığınız görünmüyor. Aşağıdaki ağınızdaki firmalara bakın.', 'Nobody you know works at the listed companies. Look at the companies in your network below.')}</p>}</div>
      <div className="studio-band"><h2 className="network-title"><Building2 size={15} aria-hidden="true" />{t('Ağınızdaki firmalar', 'Companies in your network')}</h2>
        <p className="coach-muted">{t('Karar verici tanıdığınız olan firmalar önce. Uygun olanları web sitesiyle adaylara ekleyin.', 'Companies where you know a decision maker come first. Add the ones that fit, with their website.')}</p>
        <ul className="network-list">{data.companies.map(item => <li key={item.key} className="network-company"><div><strong>{item.company}</strong><br /><span className="coach-muted">{t(`${item.people} tanıdık${item.decisionMakers ? `, ${item.decisionMakers} karar verici` : ''}`, `${item.people} connection(s)${item.decisionMakers ? `, ${item.decisionMakers} decision maker(s)` : ''}`)}</span></div>
          {data.canWrite && <form className="sales-inline" onSubmit={event => { event.preventDefault(); void run(`add-${item.key}`, { action: 'add-company', key: item.key, website: site[item.key] || '' }).then(value => { if (value) { setNotice(t('Firma adaylara eklendi.', 'Company added as a candidate.')); onChanged(); } }); }}>
            <input aria-label={t('Web sitesi', 'Website')} placeholder="firma.com" value={site[item.key] || ''} onChange={event => setSite({ ...site, [item.key]: event.target.value })} />
            <button type="submit" className="studio-text-button" disabled={Boolean(busy) || !(site[item.key] || '').includes('.')}><Building2 size={14} />{t('Adaylara ekle', 'Add as candidate')}</button></form>}</li>)}</ul></div>
      <div className="studio-band"><form className="sales-inline" onSubmit={event => { event.preventDefault(); void run('search', { action: 'search', q: query }); }}>
        <input aria-label={t('Tanıdık ara', 'Search connections')} placeholder={t('İsim, firma veya pozisyon ara', 'Search by name, company or position')} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit" className="studio-secondary" disabled={Boolean(busy) || query.trim().length < 2}><Search size={14} />{t('Ara', 'Search')}</button></form>
        {data.results.length > 0 && <ul className="network-list">{data.results.map(contact => <li key={contact.id}>{person(contact, null)}</li>)}</ul>}</div>
    </>}
  </section>;
}
