'use client';
import { useState, type ChangeEvent } from 'react';
import { Building2, Check, Copy, FileUp, KeyRound, Loader2, Radar, Search, Sparkles, Trash2, UserSearch, Users } from 'lucide-react';
import { SIGNALS, type SignalKey, type SignalWish } from '@/lib/platform/prospect-finder-types';
import { SOURCE_LIMITS, SOURCE_TERMS, SOURCE_TERMS_VERSION, type SourceKind, type SourcesSnapshot } from '@/lib/platform/prospect-sources-types';
import type { PeopleResult, PersonCandidate } from '@/lib/platform/prospect-people';

export type SourcesPost = <T>(key: string, body: Record<string, unknown>, message?: string) => Promise<T | null>;
type Lookalike = { examples: number; sector: string; city: string; signals: Partial<Record<SignalKey, SignalWish>> };
const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };

// The owner's acceptance of one source's responsibility text.
function Terms({ tr, kind, data, busy, post }: { tr: boolean; kind: SourceKind; data: SourcesSnapshot; busy: string; post: SourcesPost }) {
  const t = (a: string, b: string) => tr ? a : b, [ok, setOk] = useState(false), accepted = data.terms[kind];
  if (accepted) return <p className="coach-muted">{t('Sorumluluk metni kabul edildi.', 'Responsibility text accepted.')}{data.canAcceptTerms && <> <button type="button" className="studio-text-button finder-inline" onClick={() => void post(`terms-${kind}`, { action: 'revoke-terms', kind }, t('Onay geri alındı; bu kaynak kapandı.', 'Acceptance withdrawn; this source is off.'))}>{t('Onayı geri al', 'Withdraw')}</button></>}</p>;
  return data.canAcceptTerms ? <div className="finder-terms" role="group" aria-label={t('Sorumluluk metni', 'Responsibility text')}>
    <p><strong>{kind === 'list' ? t('Liste ve kişi adresi kaynakları için bir kez onay gerekir.', 'List and person address sources need a one-time acceptance.') : t('Ziyaretçi firma tespiti için bir kez onay gerekir.', 'Visitor company identification needs a one-time acceptance.')}</strong> {t('Verinin kullanılmasından işletmeniz sorumludur.', 'Your business is responsible for how the data is used.')}</p>
    <details className="finder-terms-text"><summary>{t('Metnin tamamını oku', 'Read the full text')}</summary><p>{SOURCE_TERMS[kind][tr ? 0 : 1]}</p></details>
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
        <p className="coach-muted">{t('Aramalar sizin Hunter kredinizi kullanır; bulunan kişi adresleri firmanın kartına “Hunter” etiketiyle eklenir. Hunter olmadan da kartta “Karar vericiyi bul” firmanın sitesindeki kurucu veya müdürü ve tanıdıklarınızı bulur; adres, firmanın adres düzeniyle (Hunter sonucu varsa ondan öğrenilir) önerilir.', 'Searches use your own Hunter credits; person addresses found are added to the company card labelled “Hunter”. Without Hunter, “Find the decision maker” on the card finds the founder or manager named on the company’s site and the people you know there; the address follows the company’s pattern (learned from a Hunter result when there is one).')}</p>
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
const ORIGIN_LABELS: Record<PersonCandidate['origin'], [string, string]> = { site: ['Firmanın sitesinde', 'On the company’s site'], network: ['Tanıdığınız', 'In your network'], hunter: ['Hunter', 'Hunter'] };
const EMAIL_KIND: Record<PersonCandidate['emailKind'], [string, string]> = { found: ['bulunan adres', 'found address'], pattern: ['firmanın adres düzeniyle', 'the company’s address pattern'], guess: ['tahmini, doğrulanmadı', 'guessed, not verified'] };
// Person addresses on a company card: find the decision maker (the company's own site, the team's connections, the
// team's Hunter results) and write to them; or the team's Hunter search, or a guess from a name the team knows.
export function ProspectPeopleTools({ tr, id, data, busy, post, onPicked }: { tr: boolean; id: string; data: SourcesSnapshot; busy: string; post: SourcesPost; onPicked?: (contactId: string) => void }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1, [open, setOpen] = useState(false), [name, setName] = useState({ first: '', last: '' }), [found, setFound] = useState<PeopleResult | null>(null);
  if (!data.canWrite) return null;
  if (!data.terms.list) return <p className="coach-muted people-hint"><UserSearch size={13} aria-hidden="true" /> {t('Karar vericiyi (ör. kurucu, genel müdür) bulup ona yazmak için proje sahibinin kişi verisi sorumluluk metnini kabul etmesi gerekir: Firma bul → Gelişmiş kaynaklar.', 'To find the decision maker (e.g. the founder or managing director) and write to them, the project owner must accept the person data responsibility text: Find companies → Advanced sources.')}</p>;
  const pick = (person: PersonCandidate) => void post<{ contactId: string | null }>(`pick-${id}`, { action: 'pick-person', id, name: person.name, position: person.position, origin: person.origin }, t(`${person.name} için iş adresi eklendi; satış e-postasının alıcısı yapıldı.`, `A work address for ${person.name} was added and made the sales email recipient.`))
    .then(value => { if (value?.contactId) { onPicked?.(value.contactId); setFound(null); } });
  return <div className="people-tools">
    <div className="sales-inline">
      <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post<PeopleResult>(`people-${id}`, { action: 'people', id }).then(value => { if (value) setFound(value); })}>{busy === `people-${id}` ? <Loader2 size={14} className="animate-spin" /> : <UserSearch size={14} />}{t('Karar vericiyi bul', 'Find the decision maker')}</button>
      {data.hunter.configured && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post<{ found: number }>(`hunter-${id}`, { action: 'hunter', id })}>{busy === `hunter-${id}` ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{t('Hunter’da kişi ara', 'Find people on Hunter')}</button>}
      <button type="button" className="studio-text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{t('Adını bildiğim kişi', 'Someone I know by name')}</button>
    </div>
    {found && <div className="people-results" role="region" aria-label={t('Karar verici adayları', 'Decision maker candidates')}>
      {found.mail === 'none' && <p className="sales-reminder">{t(`${found.domain} alan adı e-posta almıyor (MX kaydı yok); bu firmaya e-posta yerine telefon veya LinkedIn deneyin.`, `${found.domain} does not receive email (no MX record); try the phone or LinkedIn instead.`)}</p>}
      {found.candidates.length ? <ul className="people-list">{found.candidates.map(person => <li key={person.key}>
        <div><strong>{person.name}</strong>{person.position && <span className="coach-muted"> · {person.position}</span>}
          <div className="people-meta"><span className="finder-chip">{ORIGIN_LABELS[person.origin][idx]}</span>{person.decisionMaker && <span className="finder-chip is-strong">{t('Karar verici', 'Decision maker')}</span>}
            {person.sourceUrl && person.origin === 'site' && <a className="coach-muted" href={person.sourceUrl} target="_blank" rel="noreferrer">{t('kaynak sayfa', 'source page')}</a>}</div>
          {person.email && <p className="coach-muted">{person.email} · {EMAIL_KIND[person.emailKind][idx]}</p>}</div>
        <button type="button" className="studio-text-button" disabled={Boolean(busy) || found.mail === 'none' || !person.email} onClick={() => person.contactId ? onPicked?.(person.contactId) : pick(person)}><Check size={14} />{t('Bu kişiye yaz', 'Write to this person')}</button>
      </li>)}</ul>
        : <p className="coach-muted">{t(`Firmanın sitesinde ${found.pagesRead} sayfa okundu ama ad ve unvan birlikte geçmiyor; tanıdıklarınızda da bu firmadan kimse yok. LinkedIn bağlantılarınızı yükleyin veya adını bildiğiniz kişiyi girin.`, `${found.pagesRead} page(s) of the company’s site were read but no name appears with a title, and nobody in your connections works there. Upload your LinkedIn connections or enter someone you know by name.`)}</p>}
      <p className="coach-muted">{found.pattern ? t(`Firmanın adres düzeni: ${found.pattern}@${found.domain}.`, `The company’s address pattern: ${found.pattern}@${found.domain}.`) : t(`Firmanın adres düzeni bilinmiyor; en yaygın düzen (ad.soyad@${found.domain}) kullanılır ve doğrulanmaz. Geri dönerse gönderim durur.`, `The company’s address pattern is unknown; the most common one (first.last@${found.domain}) is used and not verified. A bounce stops the sending.`)} {t('Kişinin iş adresine giden ilk e-postaya adresin nereden alındığı ve aydınlatma metni bağlantısı eklenir; kişi tek tıkla çıkabilir.', 'The first email to a person’s work address says where the address came from and links your privacy notice; they can opt out with one click.')}</p>
      <button type="button" className="studio-text-button" onClick={() => setFound(null)}>{t('Kapat', 'Close')}</button>
    </div>}
    {open && <form className="sales-inline" onSubmit={event => { event.preventDefault(); void post(`guess-${id}`, { action: 'guess', id, firstName: name.first, lastName: name.last }, t('Tahmini adresler eklendi; doğrulanmadılar.', 'Guessed addresses added; they are not verified.')).then(value => { if (value) { setOpen(false); setName({ first: '', last: '' }); } }); }}>
      <input aria-label={t('Ad', 'First name')} placeholder={t('Ad', 'First name')} maxLength={40} value={name.first} onChange={event => setName({ ...name, first: event.target.value })} />
      <input aria-label={t('Soyad', 'Last name')} placeholder={t('Soyad', 'Last name')} maxLength={60} value={name.last} onChange={event => setName({ ...name, last: event.target.value })} />
      <button type="submit" className="studio-secondary" disabled={Boolean(busy) || name.first.trim().length < 2 || name.last.trim().length < 2}><Check size={14} />{t('Adres tahmin et', 'Guess the address')}</button></form>}
  </div>;
}
