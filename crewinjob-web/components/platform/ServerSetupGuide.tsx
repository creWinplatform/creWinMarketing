'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, CircleDashed, Clock, Copy, ExternalLink, KeyRound, ListChecks, RefreshCw, ToggleLeft, TriangleAlert, XCircle } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import type { ProbeResult } from '@/lib/platform/operator-types';
import type { Checklist, SetupGroup, SetupGuide, SetupId, SetupState, SetupStep } from '@/lib/platform/server-setup-types';
import { localeTag } from '@/lib/i18n/shared';

const STATES: Record<SetupState, [string, string]> = { ready: ['Hazır', 'Ready'], missing: ['Eksik', 'Missing'], invalid: ['Hatalı', 'Needs a fix'], stale: ['Çalışmıyor', 'Not running'], later: ['Canlıda', 'On live'], decision: ['Karar sizde', 'Your decision'] };
const ICONS = { ready: CheckCircle2, missing: XCircle, invalid: TriangleAlert, stale: Clock, later: CircleDashed, decision: ToggleLeft } as const;
const CSS: Record<SetupState, string> = { ready: 'ready', missing: 'missing', invalid: 'warning', stale: 'warning', later: 'off', decision: 'off' };
const GROUPS: Record<SetupGroup, [string, string]> = { connections: ['Bağlantılar', 'Connections'], security: ['Güvenlik', 'Security'], crewin: ['Crewin sekmeleri', 'Crewin tabs'], live: ['Canlıya çıkış', 'Going live'], notifications: ['Bildirimler', 'Notifications'], switches: ['Açma kararı sizde', 'Yours to turn on'] };
// Cards that are counted in the progress line: needed now (not "on live", not a decision).
const counted = (state: SetupState) => state !== 'later' && state !== 'decision';

// Values made only in this browser (never sent): a password, a 64-character hex secret, or a VAPID key pair.
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function generate(kind: 'password' | 'hex' | 'vapid', name: string): Promise<string> {
  if (kind === 'hex') return `${name}=${[...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  if (kind === 'password') { const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.+!@%', out: string[] = []; const bytes = crypto.getRandomValues(new Uint8Array(48)); for (const byte of bytes) { if (byte < set.length * Math.floor(256 / set.length)) out.push(set[byte % set.length]); if (out.length === 24) break; } return `${name}=${out.join('')}`; }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return `${name}_PUBLIC_KEY=${b64url(raw)}\n${name}_PRIVATE_KEY=${jwk.d}`;
}

// Step-by-step setup of the server settings for the team running Ryzevo, grouped by purpose, plus the go-live checklist
// for work that is not a setting. Values to register are derived from this panel's address; secrets are never shown.
// ?setup=<card id> opens that card (the job guide and connection panels link here).
export default function ServerSetupGuide({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1;
  const [guide, setGuide] = useState<SetupGuide | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<SetupId | null>(() => { if (typeof window === 'undefined') return null; const value = new URLSearchParams(window.location.search).get('setup'); return value && /^[a-z-]{2,40}$/.test(value) ? value as SetupId : null; });
  const [copied, setCopied] = useState(''), [probes, setProbes] = useState<Partial<Record<'gemini' | 'google' | 'meta', ProbeResult>>>({}), [probing, setProbing] = useState('');
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/platform/operator?view=setup', { cache: 'no-store' }); if (!response.ok) throw new Error(); const value = await response.json() as SetupGuide; setGuide(value); setOpen(current => current ?? value.sections.find(item => ['missing', 'invalid', 'stale'].includes(item.state))?.id ?? null); }
    catch { setError(tr ? 'Kurulum durumu alınamadı. Yeniden kontrol ederek tekrar deneyin.' : 'Could not load the setup status. Check again to retry.'); }
    finally { setLoading(false); }
  }, [tr]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (open && guide) document.getElementById(`setup-${open}`)?.scrollIntoView({ block: 'start' }); }, [guide, open]);
  // Clipboard API first; if the browser refuses (permission, embedded view), the older copy command; if that fails too,
  // the value is selected on the page so Ctrl+C copies it, and the button says so.
  const [failed, setFailed] = useState('');
  const copy = async (key: string, value: string) => {
    const done = (ok: boolean) => { setCopied(ok ? key : ''); setFailed(ok ? '' : key); window.setTimeout(() => { setCopied(current => current === key ? '' : current); setFailed(current => current === key ? '' : current); }, ok ? 2500 : 6000); };
    try { await navigator.clipboard.writeText(value); return done(true); } catch { /* fall back below */ }
    const area = document.createElement('textarea'); area.value = value; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area); area.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } area.remove();
    if (!ok) { const target = document.querySelector(`[data-copy-id="${key}"]`); const range = document.createRange(); if (target) { range.selectNodeContents(target); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } }
    done(ok);
  };
  const runProbe = async (id: 'gemini' | 'google' | 'meta') => { setProbing(id); try { const response = await fetch('/api/platform/operator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'probe', id }) }); const value = response.ok ? await response.json() as ProbeResult : { id, ok: false, status: response.status, checkedAt: new Date().toISOString() }; setProbes(current => ({ ...current, [id]: value })); } finally { setProbing(''); } };
  const make = async (key: string, step: SetupStep) => { if (!step.generate) return; try { const value = await generate(step.generate.kind, step.generate.name); setGenerated(current => ({ ...current, [key]: value })); } catch { setGenerated(current => ({ ...current, [key]: '' })); } };
  const needed = guide?.sections.filter(item => counted(item.state)) || [], ready = needed.filter(item => item.state === 'ready').length;
  const CopyButton = ({ id, value, label }: { id: string; value: string; label: string }) => <><button type="button" className="studio-text-button setup-copy" onClick={() => void copy(id, value)} aria-label={tr ? `${label}: kopyala` : `${label}: copy`}><Copy size={13} aria-hidden="true" />{copied === id ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Kopyala' : 'Copy')}</button>
    {failed === id && <span role="status" className="setup-copy-failed">{tr ? 'Tarayıcı kopyalamaya izin vermedi; metin seçildi, Ctrl+C ile kopyalayın.' : 'The browser did not allow copying; the text is selected, press Ctrl+C.'}</span>}</>;
  return <section className="studio-band server-setup" aria-busy={loading} aria-labelledby="server-setup-title">
    <div className="plan-section-heading"><h3 id="server-setup-title">{tr ? 'Kurulum rehberi' : 'Setup guide'}</h3>
      <button type="button" className="studio-text-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />{tr ? 'Yeniden kontrol et' : 'Check again'}</button></div>
    <p className="coach-muted">{tr ? 'Sunucu ayarlarının hepsi burada: her kart neyi açtığını, ne eksik veya hatalı olduğunu ve adım adım ne yapacağınızı gösterir. Ayar değerleri burada görünmez ve buradan yazılmaz; yalnız nereye ne yazacağınız gösterilir. “Üret” ile yapılan değerler yalnız bu tarayıcıda üretilir.' : 'Every server setting is here: each card shows what it opens, what is missing or wrong and what to do step by step. Setting values are never shown or written here; only what to put where. Values made with “Generate” are made only in this browser.'}</p>
    {error && <p role="alert" className="studio-error">{error}</p>}
    {guide && <>
      <p className="operator-summary"><span className={`operator-state ${ready === needed.length ? 'ready' : 'warning'}`}>{tr ? `Şimdi gereken ${needed.length} kurulumdan ${ready} tanesi hazır` : `${ready} of ${needed.length} needed now are set up`}</span><span className="coach-muted">{tr ? `Bu panelin adresi: ${guide.origin}` : `This panel’s address: ${guide.origin}`}</span></p>
      {(Object.keys(GROUPS) as SetupGroup[]).map(group => { const list = guide.sections.filter(item => item.group === group); return list.length ? <div key={group} className="setup-group"><h4>{GROUPS[group][idx]}</h4>
        {list.map(section => { const Icon = ICONS[section.state], expanded = open === section.id; return <article key={section.id} id={`setup-${section.id}`} className={`setup-card ${CSS[section.state]}${expanded ? ' expanded' : ''}`}>
          <button type="button" className="setup-head" aria-expanded={expanded} aria-controls={`setup-body-${section.id}`} onClick={() => setOpen(expanded ? null : section.id)}>
            <Icon size={18} aria-hidden="true" /><strong>{section.title[lang]}</strong><span className={`operator-state ${CSS[section.state]}`}>{STATES[section.state][idx]}</span></button>
          {expanded && <div id={`setup-body-${section.id}`} className="setup-body">
            <p className="setup-unlocks"><strong>{section.state === 'decision' ? '' : (tr ? 'Açtığı özellikler: ' : 'What it opens: ')}</strong>{section.unlocks.map(item => item[lang]).join(' · ')}</p>
            {section.state === 'later' && <p className="coach-muted">{tr ? 'Bu bilgisayarda gerekmez; canlı sunucuya geçerken yapılır. Kart canlı adresten açıldığında durumu gösterir.' : 'Not needed on this machine; it is done when moving to the live server. Opened from the live address, the card shows its state.'}</p>}
            {section.problems.length > 0 && <ul className="setup-problems">{section.problems.map(item => <li key={item.en}><TriangleAlert size={13} aria-hidden="true" />{item[lang]}</li>)}</ul>}
            {section.state === 'ready' && section.id !== 'worker' && <p className="setup-done"><CheckCircle2 size={14} aria-hidden="true" />{tr ? 'Ayarlar tanımlı ve geçerli. Aşağıdaki son adımla panelde deneyin.' : 'The settings are present and valid. Try it in the panel with the last step below.'}</p>}
            {section.id === 'worker' && <p className="coach-muted">{section.lastRunAt ? (tr ? `Son başarılı çalışma: ${new Date(section.lastRunAt).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}` : `Last successful run: ${new Date(section.lastRunAt).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}`) : (tr ? 'Henüz hiç çalışmadı.' : 'It has not run yet.')}</p>}
            <ol className="setup-steps">{section.steps.map((step, index) => { const key = `${section.id}-${index}`, made = generated[key]; return <li key={index}>
              <p>{step.text[lang]}</p>
              {(step.link || step.copy || step.generate) && <div className="setup-step-tools">
                {step.link && <a className="studio-text-button" href={step.link.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{step.link.label[lang]}</a>}
                {step.copy && <span className="setup-value"><span className="coach-muted">{step.copy.label[lang]}</span><code data-copy-id={key}>{step.copy.value}</code><CopyButton id={key} value={step.copy.value} label={step.copy.label[lang]} /></span>}
                {step.generate && <button type="button" className="studio-secondary" onClick={() => void make(key, step)}><KeyRound size={14} aria-hidden="true" />{made ? (tr ? 'Yeniden üret' : 'Generate again') : (tr ? 'Üret' : 'Generate')}</button>}
              </div>}
              {made && <div className="setup-env setup-generated"><div className="setup-env-head"><span>{tr ? 'Yalnız bu tarayıcıda üretildi; sayfa yenilenince kaybolur' : 'Made only in this browser; gone when the page reloads'}</span><CopyButton id={`${key}-made`} value={made} label={tr ? 'Üretilen satır' : 'Generated line'} /></div><pre data-copy-id={`${key}-made`}>{made}</pre></div>}
              {made === '' && <p className="setup-copy-failed">{tr ? 'Bu tarayıcı değer üretemedi; güncel bir tarayıcıda deneyin.' : 'This browser could not make the value; try a current browser.'}</p>}
            </li>; })}</ol>
            {section.env && <div className="setup-env"><div className="setup-env-head"><span>{guide.local ? '.env.local' : (tr ? 'Ortam değişkenleri' : 'Environment')}</span><CopyButton id={`${section.id}-env`} value={section.env} label={tr ? 'Ayar satırları' : 'Setting lines'} /></div><pre data-copy-id={`${section.id}-env`}>{section.env}</pre></div>}
            <div className="setup-verify"><p><strong>{tr ? 'Son adım: ' : 'Last step: '}</strong>{section.verify.text[lang]}</p>
              <div className="setup-step-tools">
                {section.verify.probe && (() => { const id = section.verify.probe!, result = probes[id]; return <>
                  <button type="button" className="studio-secondary" disabled={Boolean(probing) || section.state === 'missing'} onClick={() => void runProbe(id)}><Activity size={14} aria-hidden="true" />{probing === id ? (tr ? 'Deneniyor…' : 'Checking…') : (tr ? 'Dene' : 'Check')}</button>
                  {result && <span role="status" className={`operator-state ${result.ok ? 'ready' : 'missing'}`}>{result.ok ? (id === 'gemini' ? (tr ? 'Anahtar ve model çalışıyor' : 'Key and model work') : (tr ? 'Kimlik bilgileri geçerli' : 'Credentials are valid')) : (tr ? `Doğrulanamadı${result.status ? ` (HTTP ${result.status})` : ''}` : `Not verified${result.status ? ` (HTTP ${result.status})` : ''}`)}</span>}
                  {result?.detail && <p className="setup-probe-detail">{result.detail[lang]}</p>}
                </>; })()}
                {section.verify.href && <a className="studio-primary" href={section.verify.href}>{tr ? 'Panelde dene' : 'Try it in the panel'}<ArrowRight size={14} aria-hidden="true" /></a>}
              </div></div>
          </div>}
        </article>; })}
      </div> : null; })}
    </>}
    <GoLiveChecklist lang={lang} />
  </section>;
}

// Work that is not a setting. Ticking records who and when; the system does not check these itself.
function GoLiveChecklist({ lang }: { lang: Locale }) {
  const tr = lang === 'tr';
  const [list, setList] = useState<Checklist | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { void fetch('/api/platform/operator?view=checklist', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(setList).catch(() => setList(null)); }, []);
  const toggle = async (id: string, done: boolean) => {
    setBusy(id); setError('');
    try { const response = await fetch('/api/platform/operator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'checklist', id, done }) }); if (!response.ok) throw new Error(); setList(await response.json()); }
    catch { setError(tr ? 'Kaydedilemedi; tekrar deneyin.' : 'Could not save; try again.'); }
    finally { setBusy(''); }
  };
  if (!list) return null;
  const done = list.items.filter(item => item.done).length, who = (by: string) => by === 'legacy-admin' ? (tr ? 'Yönetici' : 'Administrator') : by;
  return <div className="setup-group go-live-checklist"><h4><ListChecks size={15} aria-hidden="true" />{tr ? `Canlıya çıkış kontrol listesi (${done}/${list.items.length})` : `Go-live checklist (${done}/${list.items.length})`}</h4>
    <p className="coach-muted">{tr ? 'Ayar olmayan işler. Bitirince işaretleyin; kimin ve ne zaman işaretlediği saklanır. Sistem bunları kendisi doğrulamaz.' : 'Work that is not a setting. Tick it when done; who ticked it and when is kept. The system does not check these itself.'}</p>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <ul>{list.items.map(item => <li key={item.id} className={item.done ? 'done' : ''}>
      <label><input type="checkbox" checked={Boolean(item.done)} disabled={busy === item.id} onChange={event => void toggle(item.id, event.target.checked)} />
        <span><strong>{item.title[lang]}</strong><small>{item.detail[lang]}</small>
          {item.done && <small className="go-live-done">{tr ? `İşaretleyen: ${who(item.done.by)} · ${new Date(item.done.at).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}` : `Ticked by ${who(item.done.by)} · ${new Date(item.done.at).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}`}</small>}</span></label>
      {item.link && <a className="studio-text-button" href={item.link.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{item.link.label[lang]}</a>}
    </li>)}</ul>
  </div>;
}
