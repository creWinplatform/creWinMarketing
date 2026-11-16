'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, Send, ShieldCheck, Sparkles, Plus, X } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import type { MatchType, SearchContentView } from '@/lib/platform/ad-optimizer';
import Msg from '@/components/Msg';

type Idea = { text: string; searches: number; competition: string };
type Draft = { keywords: { text: string; match: MatchType }[]; headlines: string[]; descriptions: string[]; finalUrl: string };
const MATCH: Record<MatchType, [string, string]> = { BROAD: ['Geniş', 'Broad'], PHRASE: ['Sıralı', 'Phrase'], EXACT: ['Tam', 'Exact'] };
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);

// Keywords and responsive search ad texts of one created Google Search plan: written (or suggested by the AI),
// approved by an approver, checked by Google without creating anything, and sent only when the server allows it.
export default function AdSearchContent({ planId, tr, canWrite, canApprove, canManage }: { planId: string; tr: boolean; canWrite: boolean; canApprove: boolean; canManage: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [open, setOpen] = useState(false), [data, setData] = useState<SearchContentView | null>(null), [draft, setDraft] = useState<Draft | null>(null), [text, setText] = useState({ headlines: '', descriptions: '' });
  const [seeds, setSeeds] = useState(''), [ideas, setIdeas] = useState<Idea[]>([]), [keyword, setKeyword] = useState({ text: '', match: 'PHRASE' as MatchType });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const take = (value: SearchContentView) => { setData(value); setDraft({ keywords: value.keywords, headlines: value.headlines, descriptions: value.descriptions, finalUrl: value.finalUrl }); setText({ headlines: value.headlines.join('\n'), descriptions: value.descriptions.join('\n') }); };
  const call = useCallback(async <T,>(key: string, body: Record<string, unknown>) => {
    setBusy(key); setError(''); setNotice('');
    try { return await projectRequest<T>('/api/platform/ads/optimize', { method: 'POST', body: JSON.stringify({ ...body, provider: 'google', id: planId }), signal: AbortSignal.timeout(65000) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); return null; } finally { setBusy(''); }
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !data) void call<SearchContentView>('load', { action: 'search-content' }).then(value => { if (value) take(value); }); }, [open, data, call]);
  const current = (): Draft | null => draft && { ...draft, headlines: lines(text.headlines), descriptions: lines(text.descriptions) };
  const addKeyword = (value: string, match: MatchType) => setDraft(old => old && !old.keywords.some(item => item.text === value.toLocaleLowerCase('tr') && item.match === match) && old.keywords.length < 50 ? { ...old, keywords: [...old.keywords, { text: value.toLocaleLowerCase('tr'), match }] } : old);
  const headlineCount = lines(text.headlines), descriptionCount = lines(text.descriptions), dirty = Boolean(data && draft && JSON.stringify(current()) !== JSON.stringify({ keywords: data.keywords, headlines: data.headlines, descriptions: data.descriptions, finalUrl: data.finalUrl }));
  const state = data ? { none: t('Henüz içerik yok', 'No content yet'), draft: t('Taslak', 'Draft'), approved: t('Onaylı', 'Approved'), validated: t('Google doğruladı', 'Checked by Google'), sent: t('Google Ads’e gönderildi', 'Sent to Google Ads') }[data.state] : '';

  return <div className="ads-creatives ads-search">
    <button type="button" className="studio-text-button" aria-expanded={open} onClick={() => setOpen(!open)}><KeyRound size={15} />{t('Anahtar kelimeler ve reklam metni', 'Keywords and ad text')}{data && data.state !== 'none' ? ` · ${state}` : ''}</button>
    {open && <div className="ads-creatives-body">
      {(!data || !draft) && error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
      {!data || !draft ? <p className="coach-muted" role="status">{busy === 'load' ? t('Yükleniyor…', 'Loading…') : ''}</p> : <>
        <p className="coach-muted">{t('Arama kampanyasının reklam grubu buradan hazırlanır: anahtar kelimeler, 3–15 başlık (en çok 30 karakter) ve 2–4 açıklama (en çok 90 karakter). Onaylanan içerik önce Google’da “yalnız doğrula” ile denetlenir; bu hiçbir şey oluşturmaz.', 'Prepare the Search campaign’s ad group here: keywords, 3–15 headlines (up to 30 characters) and 2–4 descriptions (up to 90). Approved content is first checked by Google in “validate only” mode, which creates nothing.')}</p>
        {data.state === 'sent' ? <p className="coach-note"><Check size={14} /> {t('Reklam grubu, anahtar kelimeler ve reklam Google Ads’e gönderildi. Değişiklikleri Google Ads’te yapın.', 'The ad group, keywords and ad were sent to Google Ads. Make changes in Google Ads.')}</p> : <>
          <fieldset className="ads-search-group" disabled={!canWrite || Boolean(busy)}>
            <legend>{t('Anahtar kelimeler', 'Keywords')} ({draft.keywords.length}/50)</legend>
            {draft.keywords.length > 0 && <ul className="ads-keywords">{draft.keywords.map(item => <li key={`${item.match}:${item.text}`}><span>{item.match === 'EXACT' ? `[${item.text}]` : item.match === 'PHRASE' ? `"${item.text}"` : item.text}</span><small>{MATCH[item.match][idx]}</small>
              <button type="button" aria-label={t(`${item.text} kelimesini kaldır`, `Remove ${item.text}`)} onClick={() => setDraft({ ...draft, keywords: draft.keywords.filter(other => other !== item) })}><X size={13} /></button></li>)}</ul>}
            <div className="ads-form-row"><label>{t('Anahtar kelime', 'Keyword')}<input maxLength={80} value={keyword.text} onChange={event => setKeyword({ ...keyword, text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (keyword.text.trim()) { addKeyword(keyword.text.trim(), keyword.match); setKeyword({ ...keyword, text: '' }); } } }} /></label>
              <label>{t('Eşleme', 'Match')}<select value={keyword.match} onChange={event => setKeyword({ ...keyword, match: event.target.value as MatchType })}>{(Object.keys(MATCH) as MatchType[]).map(item => <option key={item} value={item}>{MATCH[item][idx]}</option>)}</select></label>
              <button type="button" className="studio-secondary" disabled={!keyword.text.trim()} onClick={() => { addKeyword(keyword.text.trim(), keyword.match); setKeyword({ ...keyword, text: '' }); }}><Plus size={14} />{t('Ekle', 'Add')}</button></div>
            {data.googleConfigured && <div className="ads-form-row ads-seed-row"><label>{t('Fikir için birkaç kelime (virgülle)', 'A few words for ideas (comma separated)')}<input value={seeds} onChange={event => setSeeds(event.target.value)} /></label>
              <button type="button" className="studio-secondary" onClick={() => void call<{ ideas: Idea[] }>('ideas', { action: 'keyword-ideas', seeds: seeds.split(',').map(item => item.trim()).filter(Boolean), language: tr ? 'tr' : 'en' }).then(value => { if (value) { setIdeas(value.ideas); if (!value.ideas.length) setNotice(t('Google bu kelimeler için öneri döndürmedi.', 'Google returned no ideas for these words.')); } })}>{busy === 'ideas' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}{t('Google’dan öneri al', 'Get ideas from Google')}</button></div>}
            {ideas.length > 0 && <div className="ads-ideas" role="list" aria-label={t('Google anahtar kelime önerileri', 'Google keyword ideas')}>{ideas.map(item => <button type="button" role="listitem" key={item.text} className="ads-idea" aria-pressed={draft.keywords.some(other => other.text === item.text)} onClick={() => addKeyword(item.text, 'PHRASE')}>{item.text}<small>{item.searches.toLocaleString(tr ? 'tr-TR' : 'en-US')}/{t('ay', 'mo')}{item.competition && item.competition !== 'UNSPECIFIED' ? ` · ${({ LOW: t('düşük', 'low'), MEDIUM: t('orta', 'medium'), HIGH: t('yüksek', 'high') } as Record<string, string>)[item.competition] || item.competition}` : ''}</small></button>)}</div>}
          </fieldset>
          <fieldset className="ads-search-group" disabled={!canWrite || Boolean(busy)}>
            <legend>{t('Reklam metni', 'Ad text')}</legend>
            <label>{t(`Başlıklar — her satıra bir tane (${headlineCount.length}/15)`, `Headlines — one per line (${headlineCount.length}/15)`)}<textarea rows={6} value={text.headlines} onChange={event => setText({ ...text, headlines: event.target.value })} aria-describedby={`hl-${planId}`} /></label>
            <p id={`hl-${planId}`} className={`coach-muted ${headlineCount.some(item => item.length > 30) ? 'ads-over' : ''}`}>{headlineCount.some(item => item.length > 30) ? t(`30 karakteri aşan başlık: ${headlineCount.filter(item => item.length > 30).map(item => `“${item}” (${item.length})`).join(', ')}`, `Over 30 characters: ${headlineCount.filter(item => item.length > 30).map(item => `“${item}” (${item.length})`).join(', ')}`) : t('Her başlık en çok 30 karakter.', 'Each headline up to 30 characters.')}</p>
            <label>{t(`Açıklamalar — her satıra bir tane (${descriptionCount.length}/4)`, `Descriptions — one per line (${descriptionCount.length}/4)`)}<textarea rows={4} value={text.descriptions} onChange={event => setText({ ...text, descriptions: event.target.value })} /></label>
            {descriptionCount.some(item => item.length > 90) && <p className="coach-muted ads-over">{t('90 karakteri aşan açıklama var.', 'A description is over 90 characters.')}</p>}
            <label>{t('Hedef adres (planın sitesi)', 'Final URL (the plan’s site)')}<input type="url" value={draft.finalUrl} onChange={event => setDraft({ ...draft, finalUrl: event.target.value })} /></label>
            <button type="button" className="studio-secondary" onClick={() => void call<{ headlines: string[]; descriptions: string[] }>('ai', { action: 'draft-texts', keywords: draft.keywords.map(item => item.text) }).then(value => { if (value) { setText({ headlines: value.headlines.join('\n'), descriptions: value.descriptions.join('\n') }); setNotice(t('AI önerisi yazıldı. Gözden geçirip kaydedin; kaydedilmeden hiçbir yere gitmez.', 'AI suggestion filled in. Review and save it; nothing is used until saved.')); } })}>{busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{t('AI ile metin öner', 'Suggest text with AI')}</button>
          </fieldset>
          <div className="coach-action-buttons">
            {canWrite && <button type="button" className="studio-primary" disabled={Boolean(busy) || !dirty} onClick={() => { const value = current(); if (value) void call<SearchContentView>('save', { action: 'save-content', ...value, expectedDigest: data.digest }).then(result => { if (result) { take(result); setNotice(t('Taslak kaydedildi. Göndermeden önce onay gerekir.', 'Draft saved. It needs approval before sending.')); } }); }}>{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t('Taslağı kaydet', 'Save draft')}</button>}
            {data.state === 'draft' && canApprove && !dirty && <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => void call<SearchContentView>('approve', { action: 'approve-content', digest: data.digest }).then(result => { if (result) { take(result); setNotice(result.googleConfigured ? t('İçerik onaylandı. Şimdi Google’da doğrulayabilirsiniz.', 'Content approved. You can now check it with Google.') : t('İçerik onaylandı.', 'Content approved.')); } })}><ShieldCheck size={14} />{t('İçeriği onayla', 'Approve content')}</button>}
            {['approved', 'validated'].includes(data.state) && canWrite && !dirty && <button type="button" className="studio-secondary" disabled={Boolean(busy) || !data.googleConfigured} onClick={() => void call<SearchContentView>('validate', { action: 'validate-content' }).then(result => { if (result) { take(result); setNotice(result.lastError ? '' : t('Google içeriği kabul etti; hiçbir şey oluşturulmadı.', 'Google accepted the content; nothing was created.')); } })}>{busy === 'validate' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{t('Google’da doğrula (oluşturmaz)', 'Check with Google (creates nothing)')}</button>}
            {data.state === 'validated' && canManage && !dirty && <button type="button" className="studio-secondary" disabled={Boolean(busy) || !data.sendEnabled} title={data.sendEnabled ? undefined : t('Google Ads’e gönderim bu sunucuda kapalı.', 'Sending to Google Ads is off on this server.')} onClick={() => void call<SearchContentView>('send', { action: 'send-content' }).then(result => { if (result) { take(result); if (!result.lastError) setNotice(t('Reklam grubu Google Ads’e gönderildi. Kampanya duraklatılmışsa harcama başlamaz.', 'The ad group was sent to Google Ads. A paused campaign does not spend.')); } })}><Send size={14} />{t('Google Ads’e gönder', 'Send to Google Ads')}</button>}
          </div>
          {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}{notice && <p className="coach-note" role="status">{notice}</p>}
          {data.lastError && <p className="studio-error" role="alert"><Msg text={data.lastError} /></p>}
          {!data.sendEnabled && data.state === 'validated' && <p className="coach-muted">{t('Gönderim bu sunucuda kapalı (PLATFORM_GOOGLE_ADS_CONTENT_ENABLED). Doğrulanan içeriği Google Ads’e elle de girebilirsiniz.', 'Sending is off on this server (PLATFORM_GOOGLE_ADS_CONTENT_ENABLED). You can enter the checked content in Google Ads yourself.')}</p>}
          {!data.googleConfigured && <p className="coach-muted">{t('Google Ads geliştirici anahtarı yapılandırılmadığı için öneri ve doğrulama kapalı; içerik yine yazılıp onaylanabilir.', 'Ideas and checks are off because the Google Ads developer token is not configured; content can still be written and approved.')}</p>}
        </>}
      </>}
    </div>}
  </div>;
}
