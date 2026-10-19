'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Save,
  Sparkles,
  X,
  FolderOpen,
  Megaphone,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { GoalDefinition, Locale } from '@/lib/platform/catalog';
import type { UnifiedCampaign } from '@/lib/campaigns';
import type { HistoryItem } from '@/lib/content-history';
import { projectRequest,searchText } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import SegmentBindingPicker from './SegmentBindingPicker';
import Msg from '@/components/Msg';
import { COACH_PREFILL_KEY, COACH_REF } from '@/lib/platform/coach-types';
const CampaignReviewPanel=dynamic(()=>import('./CampaignReviewPanel'));
const channels = [
  'email',
  'linkedin',
  'instagram',
  'facebook',
  'twitter',
  'tiktok',
  'blog',
];
const channelNames: Record<string, [string, string]> = { email: ['E-posta', 'Email'], linkedin: ['LinkedIn', 'LinkedIn'], instagram: ['Instagram', 'Instagram'], facebook: ['Facebook', 'Facebook'], twitter: ['X', 'X'], tiktok: ['TikTok', 'TikTok'], blog: ['Blog', 'Blog'] };
const channelLabel = (channel: string, lang: Locale) => channelNames[channel]?.[lang === 'en' ? 1 : 0] || channel;
const empty = {
  name: '',
  text: '',
  subject: '',
  ctaUrl: '',
  objective: 'awareness',
  channel: 'email',
  language: 'tr',
  goalId: '',
  segmentId:'',segmentVersion:0,
};
type Draft = UnifiedCampaign | HistoryItem;
export default function ProjectDrafts({
  kind,
  lang,
  canWrite,
  goals,
  contentLanguage,
}: {
  kind: 'campaigns' | 'content';
  lang: Locale;
  canWrite: boolean;
  goals: GoalDefinition[];
  /** Projenin içerik dili (Proje ayarları). Yeni taslakların varsayılanı; arayüz dilinden bağımsızdır. */
  contentLanguage?: Locale;
}) {
  // İçerik kitleye göre yazılır: önce projenin içerik dili, yoksa arayüz dili. Taslak başına değiştirilebilir.
  const defaultLanguage: Locale = contentLanguage || lang;
  const tr = lang === 'tr',
    campaigns = kind === 'campaigns',
    endpoint = campaigns ? '/api/campaigns' : '/api/data/content-history';
  const [items, setItems] = useState<Draft[]>([]),
    [form, setForm] = useState({ ...empty, language: defaultLanguage }),
    [editingId, setEditingId] = useState<string | null>(null),
    [showEditor, setShowEditor] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [brief, setBrief] = useState(''),
    [aiBusy, setAiBusy] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [notice, setNotice] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['email']);
  const [reviewId,setReviewId]=useState<string|null>(null),[coachRef,setCoachRef]=useState('');
  const [image,setImage]=useState<{data:string;mime:string}|null>(null),[imageChanged,setImageChanged]=useState(false);
  const [extraImages,setExtraImages]=useState<{data:string;mime:string}[]>([]),[imageBusy,setImageBusy]=useState(false);
  const draftImages=image?[image,...extraImages]:[];
  const replaceImages=(images:{data:string;mime:string}[])=>{setImage(images[0]||null);setExtraImages(images.slice(1));setImageChanged(true);};
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!showEditor) return;
    editor.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    editor.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [showEditor, editingId]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectRequest<
        { items: UnifiedCampaign[] } | HistoryItem[]
      >(endpoint);
      setItems(Array.isArray(data) ? data : data.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
  }, [load]);
  // Growth coach handoff: a one-time brief for this tool, kept in this tab only. Nothing is generated or saved until the user acts.
  useEffect(() => {
    if (!canWrite) return;
    let prefill: { tab?: unknown; brief?: unknown; channel?: unknown; name?: unknown; ref?: unknown; at?: unknown } | null = null;
    try { prefill = JSON.parse(sessionStorage.getItem(COACH_PREFILL_KEY) || 'null'); sessionStorage.removeItem(COACH_PREFILL_KEY); } catch { prefill = null; }
    if (!prefill || prefill.tab !== (campaigns ? 'campaigns' : 'library') || typeof prefill.brief !== 'string' || !(Date.now() - Number(prefill.at) < 600000)) return;
    const channel = channels.includes(String(prefill.channel)) ? String(prefill.channel) : 'email';
    setReviewId(null);
    setEditingId(null);
    setForm({ ...empty, language: defaultLanguage, name: String(prefill.name || '').slice(0, 140), channel });
    setSelectedChannels([channel]);
    setBrief(prefill.brief.slice(0, 3000));
    setCoachRef(typeof prefill.ref === 'string' && COACH_REF.test(prefill.ref) && !campaigns ? prefill.ref : '');
    setImage(null);setExtraImages([]);setImageChanged(false);
    setShowEditor(true);
    setNotice(tr ? 'Brief, büyüme koçundan dolduruldu. AI taslağı üretin veya kendiniz yazın; kaydetmeden hiçbir şey saklanmaz.' : 'The brief is pre-filled from the growth coach. Generate an AI draft or write your own; nothing is stored until you save.');
  }, [canWrite, campaigns]);
  const edit = (item: Draft, clone = false) => {
    setReviewId(null);
    const media='name' in item?[]:item.images?.length?item.images:item.imageData?[{data:item.imageData,mime:item.imageMime||'image/jpeg'}]:[];
    setImage(media[0]||null);setExtraImages(media.slice(1));setImageChanged(clone);
    if ('name' in item)
      setSelectedChannels([
        ...(item.channels.email ? ['email'] : []),
        ...item.channels.social,
      ]);
    setBrief('name' in item ? '' : item.prompt || '');
    if ('name' in item)
      setForm({
        ...empty,
        language: defaultLanguage,
        name: item.name + (clone ? (tr ? ' (kopya)' : ' (copy)') : ''),
        text: item.content.text,
        subject: item.content.subject || '',
        ctaUrl: item.content.ctaUrl || '',
        objective: item.objective,
        goalId: item.goalId || '',
        segmentId:item.segmentBinding?.segmentId||'',segmentVersion:item.segmentBinding?.segmentVersion||0,
        channel: item.channels.email
          ? 'email'
          : item.channels.social[0] || 'email',
      });
    else
      setForm({
        ...empty,
        name: item.headline || '',
        language: item.language as Locale,
        text: item.content,
        channel: item.platform,
      });
    setEditingId(clone ? null : item.id);
    setCoachRef('');
    setShowEditor(true);
    setError('');
    setNotice('');
    window.scrollTo({ top: 0 });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if(imageBusy)return;
    setBusy(true);
    setError('');
    const body = campaigns
      ? {
          name: form.name,
          goalId: form.goalId,
          segmentId:form.segmentId,segmentVersion:form.segmentVersion,
          objective: form.objective,
          status: 'draft',
          channels: {
            social: selectedChannels.filter((channel) => channel !== 'email'),
            email: selectedChannels.includes('email'),
          },
          content: {
            text: form.text,
            subject: form.subject,
            ctaUrl: form.ctaUrl,
          },
        }
      : {
          content: form.text,
          platform: form.channel,
          language: form.language,
          headline: form.name,
          prompt: brief,
          ...(!editingId && coachRef ? { coachRef } : {}),
          ...(imageChanged?(draftImages.length>1?{imageData:'',images:draftImages}:{imageData:image?.data||'',imageMime:image?.mime||'',images:[]}):{}),
        };
    const url = editingId
      ? campaigns
        ? `${endpoint}/${encodeURIComponent(editingId)}`
        : `${endpoint}?id=${encodeURIComponent(editingId)}`
      : endpoint;
    try {
      await projectRequest(url, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setShowEditor(false);
      setEditingId(null);
      setNotice(tr ? 'Taslak kaydedildi.' : 'Draft saved.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (item: Draft) => {
    if (!window.confirm(tr ? 'Bu taslak silinsin mi?' : 'Delete this draft?'))
      return;
    setBusy(true);
    setError('');
    try {
      await projectRequest(
        campaigns
          ? `${endpoint}/${encodeURIComponent(item.id)}`
          : `${endpoint}?id=${encodeURIComponent(item.id)}`,
        { method: 'DELETE' },
      );
      if(reviewId===item.id)setReviewId(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const filtered = items.filter((item) => {
    const matchesChannel =
      filter === 'all' ||
      ('name' in item
        ? filter === 'email'
          ? item.channels.email
          : item.channels.social.includes(filter)
        : item.platform === filter);
    return (
      matchesChannel &&
      ('name' in item?[item.name,item.content.text]:[item.headline || '',item.content]).some(value=>searchText(value,lang).includes(searchText(search,lang)))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    currentPage = Math.min(page, pages),
    goal = goals.find((goal) => goal.id === form.goalId),
    Icon = campaigns ? Megaphone : FolderOpen;
  return (
    <section>
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">
            {campaigns
              ? tr
                ? 'KAMPANYA MERKEZİ'
                : 'CAMPAIGN HUB'
              : tr
                ? 'İÇERİK STÜDYOSU'
                : 'CONTENT STUDIO'}
          </p>
          <h1>
            {campaigns
              ? tr
                ? 'Kampanyalar'
                : 'Campaigns'
              : tr
                ? 'İçerik kütüphanesi'
                : 'Content library'}
          </h1>
          <p className="studio-subtitle">
            {campaigns
              ? tr
                ? 'Hedef, kanal ve mesaj; aynı taslakta.'
                : 'Goal, channel and message in one draft.'
              : tr
                ? 'Markanızın içerikleri, tek yerde.'
                : 'Your brand’s content, in one place.'}
          </p>
        </div>
        {canWrite && (
          <button
            disabled={busy || aiBusy}
            className="studio-primary"
            onClick={() => {
              setCoachRef('');
              setReviewId(null);
              setForm({ ...empty, language: defaultLanguage });
              setSelectedChannels(['email']);
              setEditingId(null);
              setShowEditor(true);
              setBrief('');
              setImage(null);setExtraImages([]);setImageChanged(false);
              setError('');
              setNotice('');
            }}
          >
            <Plus size={16} />
            {tr ? 'Yeni taslak' : 'New draft'}
          </button>
        )}
      </header>
      {error && (
        <p className="studio-error" role="alert">
          <Msg text={error} />
        </p>
      )}
      {notice && (
        <p className="studio-success" role="status">
          <Msg text={notice} />
        </p>
      )}
      {campaigns && (
        <p className="studio-data-notice">
          <span className="status-dot status-dot-amber" />
          {tr
            ? 'Taslak modu · Otomatik gönderim ve sosyal yayın kapalı.'
            : 'Draft mode · Automatic sending and social publishing are disabled.'}
        </p>
      )}
      {showEditor && canWrite && (
        <form ref={editor} onSubmit={save} className="studio-editor">
          <div className="studio-section-title">
            <h2>
              {editingId
                ? tr
                  ? 'Taslağı düzenle'
                  : 'Edit draft'
                : tr
                  ? 'Yeni taslak'
                  : 'New draft'}
            </h2>
            <button
              type="button"
              className="icon-button"
              disabled={busy || aiBusy}
              onClick={() => setShowEditor(false)}
              aria-label={tr ? 'Kapat' : 'Close'}
              title={tr ? 'Kapat' : 'Close'}
            >
              <X size={18} />
            </button>
          </div>
          <fieldset className="studio-form-grid" disabled={busy || aiBusy || imageBusy}>
            <label>
              {tr ? 'Ad / başlık' : 'Name / headline'}
              <input
                required={campaigns}
                maxLength={160}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder={
                  tr
                    ? 'Örn. İlk ürün demosuna davet'
                    : 'e.g. Invitation to your first product demo'
                }
              />
            </label>
            {campaigns ? (
              <fieldset className="studio-channel-choices">
                <legend>{tr ? 'Kanallar' : 'Channels'}</legend>
                {channels
                  .filter((channel) => channel !== 'blog')
                  .map((channel) => (
                    <label key={channel}>
                      <input
                        type="checkbox"
                        checked={selectedChannels.includes(channel)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...selectedChannels, channel]
                            : selectedChannels.filter(
                                (item) => item !== channel,
                              );
                          setSelectedChannels(next);
                          setForm((current) => ({
                            ...current,
                            channel: next[0] || 'email',
                          }));
                        }}
                      />
                      {channelLabel(channel, lang)}
                    </label>
                  ))}
              </fieldset>
            ) : (
              <label>
                {tr ? 'Kanal' : 'Channel'}
                <select
                  value={form.channel}
                  onChange={(event) =>
                    setForm({ ...form, channel: event.target.value })
                  }
                >
                  {channels.map((channel) => (
                    <option key={channel} value={channel}>{channelLabel(channel, lang)}</option>
                  ))}
                </select>
              </label>
            )}
            {campaigns ? (
              <>
                <label>
                  {tr ? 'Proje hedefi' : 'Project goal'}
                  <select
                    value={form.goalId}
                    onChange={(event) =>
                      setForm({ ...form, goalId: event.target.value,segmentId:'',segmentVersion:0 })
                    }
                  >
                    <option value="">
                      {tr ? 'Hedef seçin' : 'Choose a goal'}
                    </option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.label[lang]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr ? 'Kampanya amacı' : 'Campaign objective'}
                  <select
                    value={form.objective}
                    onChange={(event) =>
                      setForm({ ...form, objective: event.target.value })
                    }
                  >
                    <option value="awareness">
                      {tr ? 'Bilinirlik' : 'Awareness'}
                    </option>
                    <option value="traffic">
                      {tr ? 'Site trafiği' : 'Traffic'}
                    </option>
                    <option value="registration">
                      {tr ? 'Kayıt' : 'Registration'}
                    </option>
                    <option value="reactivation">
                      {tr ? 'Geri kazanım' : 'Reactivation'}
                    </option>
                  </select>
                </label>
                <label>
                  {tr ? 'Hedef bağlantı' : 'Target URL'}
                  <input
                    type="url"
                    value={form.ctaUrl}
                    onChange={(event) =>
                      setForm({ ...form, ctaUrl: event.target.value })
                    }
                    placeholder="https://"
                  />
                </label>
                {selectedChannels.includes('email') && (
                  <label>
                    {tr ? 'E-posta konusu' : 'Email subject'}
                    <input
                      maxLength={200}
                      value={form.subject}
                      onChange={(event) =>
                        setForm({ ...form, subject: event.target.value })
                      }
                    />
                  </label>
                )}
              </>
            ) : (
              <label>
                {tr ? 'Dil' : 'Language'}
                <select
                  value={form.language}
                  onChange={(event) =>
                    setForm({ ...form, language: event.target.value as Locale })
                  }
                >
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </select>
              </label>
            )}
            {goal && (
              <div className="studio-form-full studio-goal-context">
                <strong>{goal.audience[lang]}</strong>
                <p>{goal.stages.map((stage) => stage[lang]).join(' → ')}</p>
              </div>
            )}
            {campaigns&&<SegmentBindingPicker id={form.segmentId} version={form.segmentVersion} lang={lang} onChange={(segmentId,segmentVersion,goalId)=>setForm(current=>({...current,segmentId,segmentVersion,...(goalId?{goalId}:{})}))}/>}
            {!campaigns&&<div className="studio-form-full publication-image-editor"><label>{tr?'Gönderi görselleri':'Post images'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple={form.channel==='instagram'} disabled={imageBusy} onChange={async event=>{
              const files=Array.from(event.target.files||[]);if(!files.length)return;event.target.value='';
              if(files.length>(form.channel==='instagram'?5:1)||files.reduce((sum,file)=>sum+file.size,0)>5*1024*1024||files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){setError(tr?'Instagram için 1–5, diğer kanallar için 1 görsel seçin. Toplam en fazla 5 MB JPEG, PNG veya WebP.':'Choose 1–5 images for Instagram or one for other channels. Maximum 5 MB total; JPEG, PNG or WebP.');return;}
              setImageBusy(true);
              try{const images=[];for(const file of files){const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);});images.push({data,mime:file.type});}replaceImages(images);setError('');}catch{setError(tr?'Görsel okunamadı.':'Image could not be read.');}finally{setImageBusy(false);}
            }}/></label>{imageBusy&&<p role="status">{tr?'Görseller okunuyor…':'Reading images…'}</p>}
            <div className="publication-gallery">{draftImages.map((media,index)=><figure key={`${index}-${media.data.slice(-32)}`}><img src={`data:${media.mime};base64,${media.data}`} alt={`${tr?'Taslak görseli':'Draft image'} ${index+1}`} className="publication-image"/><figcaption><span>{index+1} / {draftImages.length}</span><div className="publication-gallery-actions">{draftImages.length>1&&<><button className="icon-button" type="button" disabled={index===0||imageBusy} title={tr?'Öne taşı':'Move earlier'} aria-label={`${tr?'Görseli öne taşı':'Move image earlier'} ${index+1}`} onClick={()=>{const next=[...draftImages];[next[index-1],next[index]]=[next[index],next[index-1]];replaceImages(next);}}><ArrowUp size={16}/></button><button className="icon-button" type="button" disabled={index===draftImages.length-1||imageBusy} title={tr?'Sona taşı':'Move later'} aria-label={`${tr?'Görseli sona taşı':'Move image later'} ${index+1}`} onClick={()=>{const next=[...draftImages];[next[index+1],next[index]]=[next[index],next[index+1]];replaceImages(next);}}><ArrowDown size={16}/></button></>}<button className="icon-button" type="button" disabled={imageBusy} title={tr?'Görseli kaldır':'Remove image'} aria-label={`${tr?'Görseli kaldır':'Remove image'} ${index+1}`} onClick={()=>replaceImages(draftImages.filter((_,i)=>i!==index))}><X size={16}/></button></div></figcaption></figure>)}</div><small>{tr?'En az 320 px genişlik · En/boy 0,8–1,91 · Instagram: en fazla 5 görsel':'At least 320 px wide · Aspect ratio 0.8–1.91 · Instagram: up to 5 images'}</small></div>}
            <div className="studio-form-full studio-ai-brief">
              <label>
                {tr ? 'AI içerik briefi' : 'AI content brief'}
                <textarea
                  rows={2}
                  maxLength={3000}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder={
                    tr
                      ? 'Kime, hangi değeri, hangi eylemle anlatacağız?'
                      : 'Who is the audience, what is the value, and what is the next action?'
                  }
                />
              </label>
              <button
                className="studio-secondary"
                type="button"
                disabled={aiBusy || !brief.trim()}
                onClick={async () => {
                  if (
                    form.text &&
                    !window.confirm(
                      tr
                        ? 'Mevcut içerik yerine AI taslağı oluşturulsun mu?'
                        : 'Replace the current text with an AI draft?',
                    )
                  )
                    return;
                  setAiBusy(true);
                  setError('');
                  try {
                    const data = await projectRequest<{ content: string }>(
                      '/api/platform/generate',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          brief,
                          channel: form.channel,
                          language: form.language,
                        }),
                      },
                    );
                    setForm((current) => ({ ...current, text: data.content }));
                    setNotice(
                      tr
                        ? 'AI taslağı hazır. Kaydetmeden önce inceleyin.'
                        : 'AI draft is ready. Review before saving.',
                    );
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : tr
                          ? 'İstek tamamlanamadı.'
                          : 'Request failed.',
                    );
                  } finally {
                    setAiBusy(false);
                  }
                }}
              >
                <Sparkles size={16} />
                {aiBusy
                  ? tr
                    ? 'Taslak hazırlanıyor…'
                    : 'Preparing draft…'
                  : tr
                    ? 'AI ile taslak üret'
                    : 'Generate AI draft'}
              </button>
            </div>
            <label className="studio-form-full">
              {tr ? 'İçerik' : 'Content'}
              <textarea
                required
                maxLength={100000}
                aria-label={tr ? 'İçerik' : 'Content'}
                aria-describedby={`${kind}-draft-count`}
                rows={8}
                disabled={aiBusy || busy}
                value={form.text}
                onChange={(event) =>
                  setForm({ ...form, text: event.target.value })
                }
              />
              <small id={`${kind}-draft-count`} className="studio-note">
                {form.text.length.toLocaleString(localeTag(lang))}{' '}
                {tr ? 'karakter' : 'characters'}
              </small>
            </label>
          </fieldset>
          <div className="studio-form-actions">
            <button
              className="studio-secondary"
              type="button"
              disabled={busy || aiBusy}
              onClick={() => setShowEditor(false)}
            >
              {tr ? 'Vazgeç' : 'Cancel'}
            </button>
            <button className="studio-primary" disabled={busy || aiBusy || imageBusy}>
              <Save size={16} />
              {busy
                ? tr
                  ? 'Kaydediliyor…'
                  : 'Saving…'
                : tr
                  ? 'Taslağı kaydet'
                  : 'Save draft'}
            </button>
          </div>
        </form>
      )}
      {campaigns&&reviewId&&<CampaignReviewPanel key={reviewId} id={reviewId} lang={lang} onClose={()=>setReviewId(null)}/>}
      <div className="studio-list-toolbar">
        <label className="studio-search">
          <Search size={16} />
          <input
            aria-label={tr ? 'Taslak ara' : 'Search drafts'}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={tr ? 'Taslaklarda ara…' : 'Search drafts…'}
          />
        </label>
        <label className="studio-filter">
          <span className="sr-only">
            {tr ? 'Kanal filtresi' : 'Channel filter'}
          </span>
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">{tr ? 'Tüm kanallar' : 'All channels'}</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>{channelLabel(channel, lang)}</option>
            ))}
          </select>
        </label>
        <span className="studio-note">
          {filtered.length} {tr ? 'taslak' : filtered.length === 1 ? 'draft' : 'drafts'}
        </span>
      </div>
      {loading ? (
        <div className="studio-skeleton" role="status">
          {tr ? 'Taslaklar yükleniyor…' : 'Loading drafts…'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="studio-empty">
          <Icon size={32} />
          <h2>
            {search
              ? tr
                ? 'Eşleşen taslak yok'
                : 'No matching drafts'
              : tr
                ? 'İlk taslağınızla başlayın'
                : 'Start with your first draft'}
          </h2>
          {canWrite && !search && (
            <button
              className="studio-text-button"
              onClick={() => setShowEditor(true)}
            >
              <Plus size={16} />
              {tr ? 'Taslak oluştur' : 'Create a draft'}
            </button>
          )}
        </div>
      ) : (
        <div className="studio-draft-list">
          {filtered
            .slice((currentPage - 1) * 20, currentPage * 20)
            .map((item) => {
              const campaign = 'name' in item ? item : null,
                history = !('name' in item) ? item : null,
                text = campaign?.content.text || history?.content || '',
                name =
                  campaign?.name ||
                  history?.headline ||
                  history?.platform ||
                  '',
                channel = campaign
                  ? [
                      ...(campaign.channels.email ? ['email'] : []),
                      ...campaign.channels.social,
                    ].map((value) => channelLabel(value, lang)).join(', ')
                  : history?.platform && channelLabel(history.platform, lang);
              return (
                <article className="studio-draft-row" key={item.id}>
                  <div className="studio-draft-top">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2>{name}</h2>
                        <span className="studio-badge">
                          {tr ? 'Taslak' : 'Draft'}
                        </span>
                      </div>
                      <p>
                        {channel} ·{' '}
                        {new Date(
                          campaign?.updatedAt ||
                            history?.timestamp ||
                            Date.now(),
                        ).toLocaleDateString(localeTag(lang))}
                      </p>
                    </div>
                    {canWrite && (
                      <div className="studio-row-actions">
                        <button
                          className="icon-button"
                          title={tr ? 'Kopyasını oluştur' : 'Duplicate draft'}
                          aria-label={`${tr ? 'Kopyala' : 'Duplicate'} ${name}`}
                          disabled={busy || aiBusy}
                          onClick={() => edit(item, true)}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          className="icon-button"
                          title={tr ? 'Düzenle' : 'Edit'}
                          aria-label={`${tr ? 'Düzenle' : 'Edit'} ${name}`}
                          disabled={busy || aiBusy}
                          onClick={() => edit(item)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button text-red-500"
                          title={tr ? 'Sil' : 'Delete'}
                          aria-label={`${tr ? 'Sil' : 'Delete'} ${name}`}
                          disabled={busy || aiBusy}
                          onClick={() => void remove(item)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  {campaign?.content.subject && (
                    <strong className="studio-email-subject">
                      {campaign.content.subject}
                    </strong>
                  )}
                  {campaign?.segmentBinding&&<p className="studio-note">{tr?'Sabit kitle sürümü':'Pinned audience version'}: v{campaign.segmentBinding.segmentVersion}</p>}
                  {campaign?.channels.email&&<button className="studio-text-button" disabled={busy||aiBusy} onClick={()=>{setShowEditor(false);setReviewId(campaign.id);}}><ClipboardCheck size={16}/>{tr?'İncele ve onayla':'Review and approve'}</button>}
                  <p
                    className={`studio-draft-content ${expanded === item.id ? '' : 'line-clamp-3'}`}
                  >
                    {text}
                  </p>
                  <button
                    className="studio-text-button"
                    onClick={() =>
                      setExpanded(expanded === item.id ? null : item.id)
                    }
                  >
                    {expanded === item.id
                      ? tr
                        ? 'Daralt'
                        : 'Collapse'
                      : tr
                        ? 'İçeriği aç'
                        : 'Read content'}
                    {expanded === item.id ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                </article>
              );
            })}
        </div>
      )}
      {pages > 1 && (
        <div className="studio-pagination">
          <span>
            {currentPage} / {pages}
          </span>
          <button
            className="icon-button"
            title={tr ? 'Önceki sayfa' : 'Previous page'}
            aria-label={tr ? 'Önceki sayfa' : 'Previous page'}
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            title={tr ? 'Sonraki sayfa' : 'Next page'}
            aria-label={tr ? 'Sonraki sayfa' : 'Next page'}
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      )}
    </section>
  );
}
