'use client';
import { useState, type ChangeEvent } from 'react';
import { Building2, Check, Copy, FileUp, KeyRound, Loader2, Radar, Search, Sparkles, Trash2, UserSearch, Users } from 'lucide-react';
import { SIGNALS, type SignalKey, type SignalWish } from '@/lib/platform/prospect-finder-types';
import { SOURCE_LIMITS, SOURCE_TERMS, SOURCE_TERMS_VERSION, type SourceKind, type SourcesSnapshot } from '@/lib/platform/prospect-sources-types';

export type SourcesPost = <T>(key: string, body: Record<string, unknown>, message?: string) => Promise<T | null>;
type Lookalike = { examples: number; sector: string; city: string; signals: Partial<Record<SignalKey, SignalWish>> };
const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };

// The owner's acceptance of one source's responsibility text.
function Terms({ tr, kind, data, busy, post }: { tr: boolean; kind: SourceKind; data: SourcesSnapshot; busy: string; post: SourcesPost }) {
  const t = (a: string, b: string) => tr ? a : b, [ok, setOk] = useState(false), accepted = data.terms[kind];
  if (accepted) return <p className="coach-muted">{t('Sorumluluk metni kabul edildi.', 'Responsibility text accepted.')}{data.canAcceptTerms && <> <button type="button" className="studio-text-button finder-inline" onClick={() => void post(`terms-${kind}`, { action: 'revoke-terms', kind }, t('Onay geri alındı; bu kaynak kapandı.', 'Acceptance withdrawn; this source is off.'))}>{t('Onayı geri al', 'Withdraw')}</button></>}</p>;
  return data.canAcceptTerms ? <div className="finder-terms" role="group" aria-label={t('Sorumluluk metni', 'Responsibility text')}>
    <p>{SOURCE_TERMS[kind][tr ? 0 : 1]}</p>
    <label className="design-toggle"><input type="checkbox" checked={ok} onChange={event => setOk(event.target.checked)} />{t('Okudum; bu verinin kullanılmasından işletmemizin sorumlu olduğunu kabul ediyorum.', 'I have read this; I accept that our business is responsible for how this data is used.')}</label>
    <button type="button" className="studio-secondary" disabled={!ok || Boolean(busy)} onClick={() => void post(`terms-${kind}`, { action: 'accept-terms', kind, accepted: true, version: SOURCE_TERMS_VERSION }, t('Kabul edildi; kaynak açıldı.', 'Accepted; the source is on.'))}><Check size={14} />{t('Kabul et', 'Accept')}</button>
  </div> : <p className="studio-note">{t('Bu kaynağı açmak için projenin sahibi sorumluluk metnini kabul etmeli.', 'The project owner must accept the responsibility text to turn this source on.')}</p>;
}

// Advanced sources: a list the team brings, the team's own Hunter account, visitor companies and lookalikes.
export function ProspectSourcesPanel({ tr, data, busy, post, finderPost, mapsReady }: { tr: boolean; data: SourcesSnapshot; busy: string; post: SourcesPost; finderPost: SourcesPost; mapsReady: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [csv, setCsv] = useState(''), [apiKey, setApiKey] = useState(''), [sites, setSites] = useState(''), [look, setLook] = useState<Lookalike | null>(null), [copied, setCopied] = useState(false);
  const readFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 300_000) { setCsv(''); return; } const reader = new FileReader(); reader.onload = () => setCsv(String(reader.result || '')); reader.readAsText(file, 'utf-8'); };
  const lookalike = async (body: Record<string, unknown>) => { const value = await finderPost<Lookalike>('lookalike', { action: 'lookalike', ...body }); if (value) setLook(value); };
  return <details className="studio-band sales-setup sources-panel">
    <summary><Sparkles size={15} aria-hidden="true" /><strong>{t('Gelişmiş kaynaklar', 'Advanced sources')}</strong><span className="coach-muted">{t('liste yükle · Hunter · ziyaretçi firmalar · benzer müşteri', 'upload a list · Hunter · visitor companies · lookalikes')}</span></summary>
    <div className="sales-setup-body">
      <section className="sources-section" aria-labelledby="src-lookalike"><h3 id="src-lookalike"><Radar size={14} aria-hidden="true" />{t('En iyi müşterilerime benzeyenleri bul', 'Find companies like my best customers')}</h3>
        <p className="coach-muted">{t('En iyi müşterilerinizin sitelerini (2–5) yazın ya da satış hunisinde kazanılan firmaları kullanın. Ortak sektör, şehir ve site özellikleri çıkarılır.', 'Enter the sites of your best customers (2–5) or use the companies won in the pipeline. Their shared sector, place and site traits are worked out.')}</p>
        {data.canWrite && <div className="prospect-form"><label>{t('Web siteleri (her satıra bir tane)', 'Websites (one per line)')}<textarea rows={3} value={sites} placeholder={'musteri1.com\nmusteri2.com'} onChange={event => setSites(event.target.value)} /></label>
          <div className="coach-action-buttons"><button type="button" className="studio-secondary" disabled={Boolean(busy) || sites.split(/\s+/).filter(Boolean).length < 2} onClick={() => void lookalike({ websites: sites.split(/\s+/).filter(Boolean) })}>{busy === 'lookalike' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{t('Sitelerden profil çıkar', 'Build a profile from the sites')}</button>
            <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void lookalike({ from: 'won' })}>{t('Kazanılan firmalardan', 'From won companies')}</button></div></div>}
        {look && <div className="sources-result">
          <p><strong>{t(`${look.examples} örnekten profil`, `Profile from ${look.examples} examples`)}</strong>{look.sector && <> · {look.sector}</>}{look.city && <> · {look.city}</>}</p>
          {Object.keys(look.signals).length ? <ul className="prospect-signals">{(Object.entries(look.signals) as [SignalKey, SignalWish][]).map(([key, wish]) => <li key={key} className={wish === 'present' ? 'is-yes' : 'is-no'}>{wish === 'present' ? '✓' : '✗'} {SIGNALS[key].label[idx]}</li>)}</ul> : <p className="coach-muted">{t('Ortak bir site özelliği çıkmadı.', 'No shared site trait came out.')}</p>}
          <div className="coach-action-buttons">
            {Object.keys(look.signals).length > 0 && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void finderPost('settings', { action: 'settings', signals: Object.fromEntries((Object.entries(look.signals) as [SignalKey, SignalWish][]).map(([key, wish]) => [key, wish])) }, t('Puanlama bu profile göre güncellendi.', 'Scoring now follows this profile.'))}><Check size={14} />{t('Puanlamaya uygula', 'Use for the score')}</button>}
            {look.sector && look.city && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void finderPost('discover', { action: 'discover', city: look.city, sector: look.sector, source: mapsReady ? 'maps' : 'osm' })}><Search size={14} />{t(`${look.city} · ${look.sector} ara`, `Search ${look.sector} · ${look.city}`)}</button>}
          </div></div>}
      </section>

      <section className="sources-section" aria-labelledby="src-list"><h3 id="src-list"><FileUp size={14} aria-hidden="true" />{t('Liste yükle (CSV)', 'Upload a list (CSV)')}</h3>
        <Terms tr={tr} kind="list" data={data} busy={busy} post={post} />
        {data.terms.list && data.canWrite && <div className="prospect-form">
          <p className="coach-muted">{t(`İlk satır başlık olmalı: Firma, Web sitesi, E-posta, Telefon, Sektör, Şehir (ilk ikisi zorunlu). Virgül veya noktalı virgül olabilir; en çok ${SOURCE_LIMITS.importRows} satır.`, `The first row is the header: Company, Website, Email, Phone, Sector, City (the first two are required). Commas or semicolons; at most ${SOURCE_LIMITS.importRows} rows.`)}</p>
          <label>{t('CSV dosyası', 'CSV file')}<input type="file" accept=".csv,text/csv,text/plain" onChange={readFile} /></label>
          <label>{t('veya yapıştırın', 'or paste it')}<textarea rows={4} value={csv} onChange={event => setCsv(event.target.value)} /></label>
          <div className="coach-action-buttons"><button type="button" className="studio-secondary" disabled={Boolean(busy) || !csv.trim()} onClick={() => void post<{ added: number; skipped: number }>('import', { action: 'import', csv }).then(value => { if (value) setCsv(''); })}>{busy === 'import' ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{t('Listeyi yükle', 'Upload the list')}</button></div>
        </div>}
        {data.imports.length > 0 && <ul className="finder-history">{data.imports.map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB')}: {t(`${item.rows} satır, ${item.added} eklendi, ${item.skipped} atlandı`, `${item.rows} rows, ${item.added} added, ${item.skipped} skipped`)}</li>)}</ul>}
      </section>

      <section className="sources-section" aria-labelledby="src-hunter"><h3 id="src-hunter"><KeyRound size={14} aria-hidden="true" />{t('Kişi adresleri: kendi Hunter hesabınız', 'Person addresses: your own Hunter account')}</h3>
        <p className="coach-muted">{t('Aramalar sizin Hunter kredinizi kullanır; bulunan kişi adresleri firmanın kartına “Hunter” etiketiyle eklenir. Kartta ayrıca sitede adı geçen bir kişi için “ad.soyad@” tahmini yapılabilir.', 'Searches use your own Hunter credits; person addresses found are added to the company card labelled “Hunter”. On the card you can also guess “first.last@” for a person named on the site.')}</p>
        {!data.terms.list ? <p className="coach-muted">{t('Önce yukarıdaki liste sorumluluk metni kabul edilmeli.', 'The list responsibility text above must be accepted first.')}</p>
          : data.hunter.configured ? <p>{t('Anahtar', 'Key')}: <code>{data.hunter.masked}</code> · {t(`bugün ${data.hunter.usedToday}/${SOURCE_LIMITS.hunterPerDay} arama`, `${data.hunter.usedToday}/${SOURCE_LIMITS.hunterPerDay} searches today`)}
            {data.canManage && <button type="button" className="studio-text-button finder-inline" disabled={Boolean(busy)} onClick={() => void post('hunter-remove', { action: 'hunter-remove' }, t('Hunter anahtarı kaldırıldı.', 'Hunter key removed.'))}><Trash2 size={13} />{t('Kaldır', 'Remove')}</button>}</p>
          : data.canManage ? <div className="sales-inline"><input type="password" name="hunter-api-key" autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" aria-label={t('Hunter API anahtarı', 'Hunter API key')} placeholder={t('Hunter API anahtarı', 'Hunter API key')} value={apiKey} onChange={event => setApiKey(event.target.value)} />
            <button type="button" className="studio-secondary" disabled={Boolean(busy) || apiKey.trim().length < 20} onClick={() => void post('hunter-key', { action: 'hunter-key', apiKey }, t('Hunter anahtarı doğrulandı ve şifreli saklandı.', 'Hunter key verified and stored encrypted.')).then(value => { if (value) setApiKey(''); })}><KeyRound size={14} />{t('Doğrula ve kaydet', 'Verify and save')}</button></div>
          : <p className="coach-muted">{t('Anahtarı bağlantı yöneticisi ekler.', 'A connection manager adds the key.')}</p>}
      </section>

      <section className="sources-section" aria-labelledby="src-visitors"><h3 id="src-visitors"><Users size={14} aria-hidden="true" />{t('Sitenizi ziyaret eden firmalar', 'Companies visiting your site')}</h3>
        <Terms tr={tr} kind="visitors" data={data} busy={busy} post={post} />
        {data.terms.visitors && !data.visitors.providerConfigured && <p className="studio-note">{t('Bu sunucuda kurum tespit sağlayıcısı (PLATFORM_IPINFO_TOKEN) henüz tanımlı değil; kod eklenebilir ama firma görünmez.', 'The organisation lookup provider (PLATFORM_IPINFO_TOKEN) is not set on this server yet; the snippet can go on your site but no company will show.')}</p>}
        {data.terms.visitors && data.canAcceptTerms && <label className="design-toggle"><input type="checkbox" checked={data.visitors.enabled} disabled={Boolean(busy)} onChange={event => void post('visitors', { action: 'visitors', enabled: event.target.checked }, event.target.checked ? t('Ziyaretçi firma tespiti açıldı. Kodu sitenize ekleyin.', 'Visitor companies are on. Add the snippet to your site.') : t('Ziyaretçi firma tespiti kapandı.', 'Visitor companies are off.'))} />{t('Ziyaretçi firma tespiti açık', 'Visitor company identification on')}</label>}
        {data.visitors.snippet && <div className="sources-snippet">
          <p className="coach-muted">{t('Bu kodu sitenizin her sayfasına ekleyin. Ziyaretçi izin ekranınızda onay verdiğinde ryzevoVisit.consent() çağırın; onay olmadan hiçbir şey gönderilmez.', 'Add this snippet to every page of your site. Call ryzevoVisit.consent() when the visitor agrees in your consent banner; nothing is sent without consent.')}</p>
          <code>{data.visitors.snippet}</code>
          <button type="button" className="studio-text-button" onClick={() => void copyText(data.visitors.snippet!).then(ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('Kodu kopyala', 'Copy the snippet')}</button></div>}
        {data.visitors.companies.length > 0 ? <ul className="sources-visitors">{data.visitors.companies.map(item => <li key={item.key}>
          <div><strong>{item.name}</strong>{item.domain && <span className="coach-muted"> · {item.domain}</span>}<br /><span className="coach-muted">{t(`${item.visits} sayfa görüntüleme · son ${new Date(item.lastSeen).toLocaleDateString('tr-TR')} · ${item.pages.join(', ')}`, `${item.visits} page views · last ${new Date(item.lastSeen).toLocaleDateString('en-GB')} · ${item.pages.join(', ')}`)}</span></div>
          {item.prospectId ? <span className="coach-state done">{t('Listede', 'On the list')}</span> : data.canWrite && item.domain && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`visitor-${item.key}`, { action: 'add-visitor', key: item.key }, t('Firma adaylara eklendi.', 'Company added as a candidate.'))}><Building2 size={14} />{t('Adaylara ekle', 'Add as candidate')}</button>}
        </li>)}</ul> : data.visitors.enabled && <p className="coach-muted">{t('Henüz tespit edilen firma yok. Bireysel internet bağlantıları ve barındırma şirketleri listelenmez.', 'No company identified yet. Home internet connections and hosting companies are not listed.')}</p>}
      </section>
    </div>
  </details>;
}

// On a company card: find person addresses in the team's Hunter account, or guess them from a name on the site.
export function ProspectPeopleTools({ tr, id, data, busy, post }: { tr: boolean; id: string; data: SourcesSnapshot; busy: string; post: SourcesPost }) {
  const t = (a: string, b: string) => tr ? a : b, [open, setOpen] = useState(false), [name, setName] = useState({ first: '', last: '' });
  if (!data.terms.list || !data.canWrite) return null;
  return <div className="sales-inline people-tools">
    {data.hunter.configured && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post<{ found: number }>(`hunter-${id}`, { action: 'hunter', id }).then(value => value)}>{busy === `hunter-${id}` ? <Loader2 size={14} className="animate-spin" /> : <UserSearch size={14} />}{t('Hunter’da kişi ara', 'Find people on Hunter')}</button>}
    <button type="button" className="studio-text-button" aria-expanded={open} onClick={() => setOpen(!open)}><UserSearch size={14} />{t('Ad soyaddan adres tahmin et', 'Guess an address from a name')}</button>
    {open && <form className="sales-inline" onSubmit={event => { event.preventDefault(); void post(`guess-${id}`, { action: 'guess', id, firstName: name.first, lastName: name.last }, t('Tahmini adresler eklendi; doğrulanmadılar.', 'Guessed addresses added; they are not verified.')).then(value => { if (value) { setOpen(false); setName({ first: '', last: '' }); } }); }}>
      <input aria-label={t('Ad', 'First name')} placeholder={t('Ad', 'First name')} maxLength={40} value={name.first} onChange={event => setName({ ...name, first: event.target.value })} />
      <input aria-label={t('Soyad', 'Last name')} placeholder={t('Soyad', 'Last name')} maxLength={60} value={name.last} onChange={event => setName({ ...name, last: event.target.value })} />
      <button type="submit" className="studio-secondary" disabled={Boolean(busy) || name.first.trim().length < 2 || name.last.trim().length < 2}><Check size={14} />{t('Tahmin et', 'Guess')}</button></form>}
  </div>;
}
