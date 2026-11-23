'use client';
import { useState, type FormEvent } from 'react';
import { Check, Copy, Gauge, Link2, Loader2, Mail, MapPin, Phone, Radar, Search, SlidersHorizontal, Star, Trash2, X } from 'lucide-react';
import { FINDER_SECTORS, FINDER_TERMS, FINDER_TERMS_VERSION, SIGNALS, SIGNAL_KEYS, type FinderSnapshot, type ProspectInsight, type SignalKey, type SignalWish } from '@/lib/platform/prospect-finder-types';

export type FinderPost = <T>(key: string, body: Record<string, unknown>, message?: string) => Promise<T | null>;
const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };

// Search for companies (Google Maps through the data provider, or OpenStreetMap), the owner's acceptance of the
// provider terms, and which signals mean an opportunity for what this team sells.
export function ProspectFinderPanel({ tr, data, busy, post }: { tr: boolean; data: FinderSnapshot; busy: string; post: FinderPost }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [form, setForm] = useState({ city: '', sector: '', source: data.mapsConfigured ? 'maps' : 'osm' as 'maps' | 'osm' }), [terms, setTerms] = useState(false), [open, setOpen] = useState<'' | 'settings'>('');
  const [wishes, setWishes] = useState<Partial<Record<SignalKey, SignalWish>>>(data.settings.signals);
  const needsTerms = form.source === 'maps' && !data.termsAccepted, mapsBlocked = form.source === 'maps' && Boolean(data.maps.blocked);
  const quotaText = data.maps.blocked === 'inactive' ? t('Google Haritalar araması etkin bir plan gerektirir.', 'Google Maps search needs an active plan.')
    : data.maps.blocked === 'project' ? t('Bu projenin Google Haritalar hakkı doldu.', 'This project’s Google Maps allowance is used up.')
    : data.maps.blocked === 'user' ? t('Bugünkü kişisel Google Haritalar hakkınız doldu.', 'Your personal Google Maps allowance for today is used up.')
    : data.maps.blocked === 'platform' ? t('Google Haritalar araması şu an geçici olarak kapalı.', 'Google Maps search is paused for now.') : '';
  const search = (event: FormEvent) => { event.preventDefault(); const sector = FINDER_SECTORS.find(item => item.tr === form.sector || item.en === form.sector);
    void post('discover', { action: 'discover', city: form.city, sector: form.sector, sectorId: sector?.id || '', source: form.source }); };
  return <section className="studio-band finder-panel" aria-labelledby="finder-title">
    <div className="finder-head"><h2 id="finder-title"><Radar size={16} aria-hidden="true" />{t('Firma bul', 'Find companies')}</h2>
      <button type="button" className="studio-text-button" aria-expanded={open === 'settings'} onClick={() => setOpen(open === 'settings' ? '' : 'settings')}><SlidersHorizontal size={14} />{t('Teklifime göre sinyaller', 'Signals for my offer')}</button></div>
    {open === 'settings' && <div className="finder-settings">
      <p className="coach-muted">{t('Sattığınız şeye göre hangi durumun fırsat olduğunu seçin; puan buna göre hesaplanır. Örneğin randevu yazılımı satıyorsanız “Online randevu: eksikse fırsat”.', 'Choose which situation is an opportunity for what you sell; the score follows it. For a booking product, for example, “Online booking: missing is an opportunity”.')}</p>
      <div className="finder-signal-grid">{SIGNAL_KEYS.map(key => <label key={key}>{SIGNALS[key].label[idx]}
        <select value={wishes[key] || ''} disabled={!data.canWrite} onChange={event => setWishes({ ...wishes, [key]: (event.target.value || undefined) as SignalWish | undefined })}>
          <option value="">{t('Önemsiz', 'Not relevant')}</option><option value="missing">{t('Eksikse fırsat', 'Missing is an opportunity')}</option><option value="present">{t('Varsa fırsat', 'Present is an opportunity')}</option></select></label>)}</div>
      {data.canWrite && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void post('settings', { action: 'settings', signals: Object.fromEntries(Object.entries(wishes).filter(([, value]) => value)) }, t('Sinyal tercihleri kaydedildi; puanlar güncellendi.', 'Signal choices saved; scores updated.'))}><Check size={14} />{t('Kaydet', 'Save')}</button>}
    </div>}
    {data.canWrite ? <form className="finder-form" onSubmit={search}>
      <div className="finder-row">
        <label>{t('Şehir veya ilçe', 'City or district')}<input required minLength={2} maxLength={80} value={form.city} placeholder={t('Ör. Kadıköy, İstanbul', 'E.g. Kadıköy, Istanbul')} onChange={event => setForm({ ...form, city: event.target.value })} /></label>
        <label>{t('Sektör', 'Sector')}<input required minLength={2} maxLength={80} list="finder-sectors" value={form.sector} placeholder={t('Ör. Diş kliniği', 'E.g. Dental clinic')} onChange={event => setForm({ ...form, sector: event.target.value })} />
          <datalist id="finder-sectors">{FINDER_SECTORS.map(item => <option key={item.id} value={item[tr ? 'tr' : 'en']} />)}</datalist></label>
        <label>{t('Kaynak', 'Source')}<select value={form.source} onChange={event => setForm({ ...form, source: event.target.value as 'maps' | 'osm' })}>
          <option value="maps" disabled={!data.mapsConfigured}>{t('Google Haritalar', 'Google Maps')}{data.mapsConfigured ? '' : t(' (yapılandırılmadı)', ' (not configured)')}</option><option value="osm">OpenStreetMap</option></select></label>
      </div>
      {needsTerms && (data.canAcceptTerms ? <div className="finder-terms" role="group" aria-label={t('Veri sağlayıcı koşulları', 'Data provider terms')}>
        <p>{FINDER_TERMS[idx]}</p>
        <label className="design-toggle"><input type="checkbox" checked={terms} onChange={event => setTerms(event.target.checked)} />{t('Okudum; bu verinin kullanılmasından işletmemizin sorumlu olduğunu kabul ediyorum.', 'I have read this; I accept that our business is responsible for how this data is used.')}</label>
        <button type="button" className="studio-secondary" disabled={!terms || Boolean(busy)} onClick={() => void post('terms', { action: 'accept-terms', accepted: true, version: FINDER_TERMS_VERSION }, t('Koşullar kabul edildi; Google Haritalar araması açıldı.', 'Terms accepted; Google Maps search is on.'))}><Check size={14} />{t('Kabul et', 'Accept')}</button>
      </div> : <p className="studio-note">{t('Google Haritalar araması için önce projenin sahibi veri sağlayıcı koşullarını kabul etmeli. Şimdilik OpenStreetMap ile arayabilirsiniz.', 'The project owner must accept the data provider terms before Google Maps search. Meanwhile you can search OpenStreetMap.')}</p>)}
      <div className="design-actions"><button className="studio-primary" disabled={Boolean(busy) || needsTerms || mapsBlocked || data.searchesLeft < 1}>{busy === 'discover' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{t('Firmaları bul', 'Find companies')}</button>
        <span className="coach-muted">{t(`Bugün ${data.searchesLeft} arama hakkı kaldı · bir aramada en çok 30 firma eklenir`, `${data.searchesLeft} searches left today · up to 30 companies per search`)}</span></div>
      {form.source === 'maps' && data.mapsConfigured && <p className={mapsBlocked ? 'studio-note finder-quota is-blocked' : 'coach-muted finder-quota'}>{quotaText || t(`Google Haritalar: bugün ${data.maps.usedToday}/${data.maps.dayLimit}, bu ay ${data.maps.usedMonth}/${data.maps.monthLimit} sorgu. Aynı arama 30 gün içinde tekrar yapılırsa hak harcamaz.`, `Google Maps: ${data.maps.usedToday}/${data.maps.dayLimit} today, ${data.maps.usedMonth}/${data.maps.monthLimit} this month. Repeating the same search within 30 days uses no allowance.`)}</p>}
    </form> : <p className="studio-note">{t('Firma aramayı içerik yazma yetkisi olan ekip üyeleri yapar.', 'Teammates who can write content search for companies.')}</p>}
    <p className="coach-muted finder-attribution">{form.source === 'osm' ? t('Veri: © OpenStreetMap katkıcıları (ODbL). Türkiye’de kayıt sayısı sınırlıdır.', 'Data: © OpenStreetMap contributors (ODbL). Coverage is limited in some regions.') : t('Veri: Google Haritalar sonuçları, DataForSEO üzerinden. Yalnız web sitesi olan işletmeler eklenir.', 'Data: Google Maps results through DataForSEO. Only businesses with a website are added.')}
      {data.termsAccepted && data.canAcceptTerms && <> · <button type="button" className="studio-text-button finder-inline" onClick={() => void post('terms', { action: 'revoke-terms' }, t('Koşul onayı geri alındı.', 'Terms acceptance withdrawn.'))}>{t('Koşul onayını geri al', 'Withdraw terms acceptance')}</button></>}</p>
    {data.searches.length > 0 && <ul className="finder-history">{data.searches.slice(0, 5).map(item => <li key={item.id}>{item.sector} · {item.city} · {item.source === 'maps' ? 'Google' : 'OSM'}: {item.status === 'failed' ? t('alınamadı', 'failed') : t(`${item.found} sonuç, ${item.added} eklendi${item.withoutWebsite ? `, ${item.withoutWebsite} sitesiz` : ''}`, `${item.found} results, ${item.added} added${item.withoutWebsite ? `, ${item.withoutWebsite} without a site` : ''}`)}</li>)}</ul>}
  </section>;
}

// The score, the signals, published contact addresses and the mini analysis link on one prospect card.
export function ProspectInsightBlock({ tr, id, insight, canWrite, busy, post }: { tr: boolean; id: string; insight: ProspectInsight; canWrite: boolean; busy: string; post: FinderPost }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [link, setLink] = useState(''), [copied, setCopied] = useState('');
  const day = (value: string) => new Date(value).toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const score = insight.score;
  const makeLink = async () => { const value = await post<{ url: string }>(`report-${id}`, { action: 'report', id }); if (value?.url) setLink(value.url); };
  const copyValue = async (value: string, key: string) => { if (await copy(value)) { setCopied(key); setTimeout(() => setCopied(''), 1800); } };
  return <div className="prospect-insight">
    <div className="prospect-score-row">
      {!insight.scannedAt && score.fit === 0 && score.reach === 0 ? <span className="prospect-score prospect-score-low"><Gauge size={13} aria-hidden="true" />{t('Puan için siteyi tarayın', 'Scan the site for a score')}</span> : <>
      <span className={`prospect-score prospect-score-${score.total >= 70 ? 'high' : score.total >= 40 ? 'mid' : 'low'}`} title={t(`Uyum ${score.fit}/40 · sinyaller ${score.signalsCounted ? `${score.signals}/40` : 'seçilmedi'} · ulaşılabilirlik ${score.reach}/20`, `Fit ${score.fit}/40 · signals ${score.signalsCounted ? `${score.signals}/40` : 'not chosen'} · reach ${score.reach}/20`)}><Gauge size={13} aria-hidden="true" />{t('Puan', 'Score')} {score.total}</span>
      <span className="coach-muted">{t(`uyum ${score.fit}/40 · sinyal ${score.signalsCounted ? `${score.signals}/40` : '—'} · ulaşılabilirlik ${score.reach}/20`, `fit ${score.fit}/40 · signals ${score.signalsCounted ? `${score.signals}/40` : '—'} · reach ${score.reach}/20`)}</span></>}
      {insight.source !== 'manual' && <span className="coach-muted"><MapPin size={12} aria-hidden="true" /> {insight.source === 'maps' ? 'Google' : 'OSM'}{insight.city ? ` · ${insight.city}` : ''}{insight.category ? ` · ${insight.category}` : ''}</span>}
      {insight.rating !== null && <span className="coach-muted"><Star size={12} aria-hidden="true" /> {insight.rating.toLocaleString(tr ? 'tr-TR' : 'en-GB')}{insight.reviews !== null ? ` (${insight.reviews})` : ''}</span>}
    </div>
    {insight.signals && <ul className="prospect-signals" aria-label={t('Sitede görülenler', 'Seen on the site')}>{insight.signals.filter(item => item.present !== null).map(item => <li key={item.key} className={item.present ? 'is-yes' : 'is-no'} title={item.evidence || undefined}>{item.present ? '✓' : '✗'} {SIGNALS[item.key].label[idx]}</li>)}</ul>}
    {insight.scannedAt && <p className="coach-muted">{t(`Site taraması: ${day(insight.scannedAt)}`, `Site scan: ${day(insight.scannedAt)}`)}</p>}
    {(insight.triggers.hiring || insight.triggers.newBusiness || insight.triggers.siteChangedAt) && <ul className="prospect-triggers" aria-label={t('Fırsat anları', 'Moments to act')}>
      {insight.triggers.hiring && <li>{t('İşe alım yapıyor', 'Hiring')}</li>}
      {insight.triggers.newBusiness && <li>{t('Yeni işletme olabilir (az yorum)', 'Maybe a new business (few reviews)')}</li>}
      {insight.triggers.siteChangedAt && <li>{t(`Site değişti (${day(insight.triggers.siteChangedAt)})`, `Site changed (${day(insight.triggers.siteChangedAt)})`)}</li>}
    </ul>}
    {insight.contacts.length > 0 && <ul className="prospect-contacts">{insight.contacts.map(item => <li key={item.id}>
      {item.kind === 'email' ? <Mail size={13} aria-hidden="true" /> : <Phone size={13} aria-hidden="true" />}<span className="prospect-contact-value">{item.value}</span>
      <small className="coach-muted">{({ site: t('firmanın sitesi', 'company site'), maps: 'Google', osm: 'OSM', import: t('yüklenen liste', 'uploaded list'), hunter: 'Hunter', guess: t('tahmini, doğrulanmadı', 'guessed, not verified') } as Record<string, string>)[item.source]}{item.person ? t(' · kişi', ' · person') : ''}{item.confidence ? ` · ${item.confidence}/100` : ''}{item.note ? ` · ${item.note}` : ''}</small>
      <button type="button" className="studio-text-button" aria-label={t(`${item.value} kopyala`, `Copy ${item.value}`)} onClick={() => void copyValue(item.value, item.id)}>{copied === item.id ? <Check size={13} /> : <Copy size={13} />}</button>
      {canWrite && <button type="button" className="studio-text-button" aria-label={t(`${item.value} kaldır`, `Remove ${item.value}`)} disabled={Boolean(busy)} onClick={() => void post(`contact-${item.id}`, { action: 'remove-contact', contactId: item.id })}><Trash2 size={13} /></button>}
    </li>)}</ul>}
    {canWrite && insight.signals && <div className="prospect-report">
      {insight.report?.active && <span className="coach-muted"><Link2 size={12} aria-hidden="true" /> {t(`Mini analiz bağlantısı açık · ${insight.report.views} görüntülenme${insight.report.lastViewedAt ? ` · son ${day(insight.report.lastViewedAt)}` : ''} · ${day(insight.report.expiresAt)} tarihine kadar`, `Mini analysis link on · ${insight.report.views} views${insight.report.lastViewedAt ? ` · last ${day(insight.report.lastViewedAt)}` : ''} · until ${day(insight.report.expiresAt)}`)}</span>}
      <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void makeLink()}>{busy === `report-${id}` ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}{insight.report?.active ? t('Yeni bağlantı oluştur', 'Create a new link') : t('Mini analiz bağlantısı oluştur', 'Create a mini analysis link')}</button>
      {insight.report?.active && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { setLink(''); void post(`revoke-${id}`, { action: 'revoke-report', id }, t('Bağlantı kapatıldı.', 'Link turned off.')); }}><X size={13} />{t('Bağlantıyı kapat', 'Turn the link off')}</button>}
      {link && <div className="prospect-link-box"><input readOnly value={link} aria-label={t('Mini analiz bağlantısı', 'Mini analysis link')} onFocus={event => event.target.select()} />
        <button type="button" className="studio-secondary" onClick={() => void copyValue(link, 'link')}>{copied === 'link' ? <Check size={14} /> : <Copy size={14} />}{t('Kopyala', 'Copy')}</button>
        <a className="studio-text-button" href={`${link}&preview=1`} target="_blank" rel="noreferrer">{t('Önizle (sayılmaz)', 'Preview (not counted)')}</a>
        <p className="coach-muted">{t('Bağlantı yalnız şimdi gösterilir; kaybederseniz yenisini oluşturun (eskisi kapanır).', 'The link is shown only now; if you lose it, create a new one (the old one stops working).')}</p></div>}
    </div>}
  </div>;
}
