'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, Loader2, MessageCircle, Smartphone } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { saveFile } from './render';

export type HandoffItem = { key: string; label: string; file: string };
type Step = { id: string; title: { tr: string; en: string }; how: { tr: string; en: string }; keys: (items: HandoffItem[]) => HandoffItem[] };
// Where each picture goes. Instagram, Facebook, LinkedIn, X and YouTube take these only in their own apps (Instagram's
// API cannot change a profile picture or highlights), so the guide makes the manual part short and checkable.
const STEPS: Step[] = [
  { id: 'ig-avatar', title: { tr: 'Instagram profil fotoğrafı', en: 'Instagram profile picture' }, how: { tr: 'Instagram → Profil → Profili düzenle → Resmi düzenle → galeriden seçin.', en: 'Instagram → Profile → Edit profile → Edit picture → choose from your gallery.' }, keys: items => items.filter(item => item.key === 'avatar') },
  { id: 'ig-highlights', title: { tr: 'Instagram öne çıkan kapakları', en: 'Instagram highlight covers' }, how: { tr: 'Profilde öne çıkana uzun basın → Öne çıkanı düzenle → Kapağı düzenle → galeriden ilgili kapağı seçin. Her öne çıkan için tekrarlayın.', en: 'On your profile, press and hold a highlight → Edit highlight → Edit cover → pick its cover from your gallery. Repeat for each highlight.' }, keys: items => items.filter(item => item.key.startsWith('highlight-')) },
  { id: 'fb-cover', title: { tr: 'Facebook sayfa kapağı ve profil fotoğrafı', en: 'Facebook Page cover and picture' }, how: { tr: 'Facebook sayfanız → Kapak fotoğrafını düzenle → Fotoğraf yükle; profil fotoğrafı için aynı profil görselini kullanın.', en: 'Your Facebook Page → Edit cover photo → Upload photo; use the same profile picture for the Page picture.' }, keys: items => items.filter(item => item.key === 'fb-cover' || item.key === 'avatar') },
  { id: 'li-cover', title: { tr: 'LinkedIn sayfa kapağı', en: 'LinkedIn page cover' }, how: { tr: 'LinkedIn sayfanız (yönetici görünümü) → Sayfayı düzenle → Kapak görseli.', en: 'Your LinkedIn page (admin view) → Edit page → Cover image.' }, keys: items => items.filter(item => item.key === 'li-cover') },
  { id: 'x-header', title: { tr: 'X başlık görseli', en: 'X header' }, how: { tr: 'X → Profil → Profili düzenle → başlık görseline dokunun.', en: 'X → Profile → Edit profile → tap the header image.' }, keys: items => items.filter(item => item.key === 'x-header') },
  { id: 'yt-banner', title: { tr: 'YouTube kanal kapağı', en: 'YouTube channel banner' }, how: { tr: 'YouTube Studio → Özelleştirme → Marka → Banner resmi → Yükle.', en: 'YouTube Studio → Customisation → Branding → Banner image → Upload.' }, keys: items => items.filter(item => item.key === 'yt-banner') },
];
const STORE = 'ryzevo:profile-handoff:';

// Profile pictures and covers onto the networks by hand, from the phone: the link (or WhatsApp to yourself) opens this
// page on the phone, each picture shows full size (press and hold to save it to the gallery), and each step says
// where it goes and can be ticked off. Ticks are remembered in this browser only.
export default function ProfileHandoff({ lang, projectId, items, render }: {
  lang: Locale; projectId: string; items: HandoffItem[]; render: (key: string) => Promise<{ url: string; bytes: Uint8Array }>;
}) {
  const tr = lang === 'tr', section = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false), [images, setImages] = useState<Record<string, { url: string; bytes: Uint8Array }>>({}), [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]), [copied, setCopied] = useState(false);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/?tab=project&settings=brandkit&handoff=1`;
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORE + projectId) || '[]')); } catch { setDone([]); }
    if (new URLSearchParams(window.location.search).get('handoff') === '1') { setOpen(true); setTimeout(() => section.current?.scrollIntoView({ block: 'start' }), 300); }
  }, [projectId]);
  useEffect(() => {
    if (!open || busy || Object.keys(images).length) return;
    setBusy(true);
    (async () => { const out: Record<string, { url: string; bytes: Uint8Array }> = {}; for (const item of items) { try { out[item.key] = await render(item.key); } catch { /* shown without that picture */ } } setImages(out); setBusy(false); })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (id: string) => { const next = done.includes(id) ? done.filter(item => item !== id) : [...done, id]; setDone(next); try { localStorage.setItem(STORE + projectId, JSON.stringify(next)); } catch { /* not remembered */ } };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt(tr ? 'Bağlantıyı kopyalayın:' : 'Copy the link:', link); } };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${tr ? 'Ryzevo profil ve kapak görselleri' : 'Ryzevo profile and cover images'}: ${link}`)}`;
  const steps = STEPS.map(step => ({ ...step, pictures: step.keys(items) })).filter(step => step.pictures.length);
  return (
    <section ref={section} className="profile-handoff" aria-labelledby="profile-handoff-title">
      <div className="studio-section-title"><h3 id="profile-handoff-title"><Smartphone size={15} aria-hidden="true" />{tr ? 'Profillere yükleme rehberi' : 'Upload guide for your profiles'}</h3>
        <p className="studio-note">{tr ? 'Bu görselleri ağlar yalnız kendi uygulamalarında kabul ediyor. Rehberi telefonda açın; her görseli galeriye kaydedip adımı işaretleyin.' : 'The networks accept these pictures only in their own apps. Open the guide on your phone, save each picture to your gallery and tick the step.'}</p></div>
      <div className="profile-handoff-share">
        <button type="button" className="studio-secondary" onClick={copy}>{copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copied ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Telefon için bağlantıyı kopyala' : 'Copy the link for your phone')}</button>
        <a className="studio-secondary" href={whatsapp} target="_blank" rel="noreferrer noopener"><MessageCircle size={15} />{tr ? 'WhatsApp’la kendime gönder' : 'Send to myself on WhatsApp'}</a>
        {!open && <button type="button" className="studio-primary" onClick={() => setOpen(true)}>{tr ? 'Rehberi aç' : 'Open the guide'}</button>}
      </div>
      <p className="studio-note">{tr ? `${done.filter(id => steps.some(step => step.id === id)).length} / ${steps.length} adım tamam.` : `${done.filter(id => steps.some(step => step.id === id)).length} of ${steps.length} steps done.`}</p>
      {open && (busy ? <p className="studio-note" role="status"><Loader2 size={14} className="animate-spin inline" /> {tr ? 'Görseller hazırlanıyor…' : 'Preparing the pictures…'}</p> : <ol className="profile-handoff-steps">{steps.map(step => <li key={step.id} className={done.includes(step.id) ? 'is-done' : ''}>
        <label className="design-toggle profile-handoff-check"><input type="checkbox" checked={done.includes(step.id)} onChange={() => toggle(step.id)} /><b>{step.title[lang]}</b></label>
        <p className="studio-note">{step.how[lang]}</p>
        <div className="profile-handoff-pictures">{step.pictures.map(item => images[item.key] && <figure key={item.key}>
          <img src={images[item.key].url} alt={item.label} />
          <figcaption><span>{item.label}</span><button type="button" className="studio-secondary" onClick={() => saveFile(images[item.key].bytes, item.file, 'image/png')}><Download size={15} />{tr ? 'Kaydet' : 'Save'}</button></figcaption>
        </figure>)}</div>
      </li>)}</ol>)}
      {open && !busy && <p className="studio-note">{tr ? 'Telefonda görsele uzun basıp “Fotoğraflara kaydet”i seçebilirsiniz.' : 'On a phone, press and hold a picture and choose “Save to Photos”.'}</p>}
    </section>
  );
}
