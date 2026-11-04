'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Link2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { translateMessage } from '@/lib/i18n/messages';

type Platform = 'tiktok' | 'pinterest' | 'youtube';
const NAMES: Record<Platform, string> = { tiktok: 'TikTok', pinterest: 'Pinterest', youtube: 'YouTube' };
// Where each provider's consent screen may live: the browser is sent only to these.
const AUTHORIZE: Record<Platform, string> = { tiktok: 'https://www.tiktok.com/v2/auth/authorize/', pinterest: 'https://www.pinterest.com/oauth/', youtube: 'https://accounts.google.com/o/oauth2/v2/auth' };

// TikTok account, Pinterest board and YouTube channel connections for approved publications.
export default function ChannelConnections({ lang, requestedProvider }: { lang: Locale; requestedProvider?: string }) {
  const tr = lang === 'tr';
  const [configured, setConfigured] = useState<Record<Platform, boolean> | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [result, setResult] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void projectRequest<{ configured: Record<Platform, boolean> }>('/api/platform/channels', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(data => setConfigured(data.configured)).catch(() => { if (!controller.signal.aborted) setConfigured({ tiktok: false, pinterest: false, youtube: false }); });
    const url = new URL(window.location.href), value = url.searchParams.get('channelConnection');
    if (value) { setResult(value); url.searchParams.delete('channelConnection'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return () => controller.abort();
  }, []);
  async function connect(event: FormEvent<HTMLFormElement>, platform: Platform) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget); setBusy(platform); setError('');
    try {
      const data = await projectRequest<{ authorizationUrl: string }>('/api/platform/channels', { method: 'POST', body: JSON.stringify({ platform, accountName: form.get('accountName'), ...(platform === 'pinterest' ? { boardId: String(form.get('boardId') || '').trim() } : {}) }), signal: AbortSignal.timeout(15000) });
      const url = new URL(data.authorizationUrl);
      if (`${url.origin}${url.pathname}` !== AUTHORIZE[platform]) throw new Error(tr ? 'Yetkilendirme adresi geçersiz.' : 'Invalid authorization URL.');
      window.location.assign(url.href);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : (tr ? 'İstek tamamlanamadı.' : 'Request failed.')); setBusy(''); }
  }
  const [donePlatform, doneState] = result.split(':');
  const notes: Record<Platform, string> = {
    tiktok: tr ? 'Video, sizin sitenizdeki adresten TikTok tarafından çekilir; alan adınızı TikTok uygulamasında doğrulayın. TikTok incelemesinden geçmemiş uygulamada gönderiler yalnız size görünür.' : 'TikTok pulls the video from your own address; verify your domain in the TikTok app. Until the app passes TikTok’s audit, posts are visible only to you.',
    pinterest: tr ? 'Pinler seçtiğiniz panoya gider. Pano kimliği, panonun adresindeki veya Pinterest API’deki sayısal kimliktir.' : 'Pins go to the board you choose. The board id is the numeric id from the Pinterest API.',
    youtube: tr ? 'Videolar Shorts olarak yüklenir. Google doğrulaması olmayan projede videolar “gizli” yüklenir.' : 'Videos are uploaded as Shorts. In a Google project without verification, videos upload as private.',
  };
  return <>
    {result && <p role="status" className={doneState === 'connected' ? 'studio-success' : 'studio-error'}>{doneState === 'connected' ? (tr ? `${NAMES[donePlatform as Platform] || 'Kanal'} bağlantısı kaydedildi. Yayından önce Yayın merkezinden izni doğrulayın.` : `${NAMES[donePlatform as Platform] || 'Channel'} connection saved. Check the publishing access in the publication center before posting.`) : (tr ? 'Kanal bağlantısı tamamlanamadı. Hesap ve uygulama izinlerini kontrol edin.' : 'The channel connection could not be completed. Check the account and app permissions.')}</p>}
    {error && <p role="alert" className="studio-error">{translateMessage(error, lang)}</p>}
    {(['tiktok', 'pinterest', 'youtube'] as Platform[]).map(platform => <details key={platform} open={requestedProvider === platform || undefined}>
      <summary className="cursor-pointer text-sm font-medium">{tr ? `${NAMES[platform]} ${platform === 'pinterest' ? 'panosu' : platform === 'youtube' ? 'kanalı' : 'hesabı'} bağla` : `Connect ${NAMES[platform]} ${platform === 'pinterest' ? 'board' : platform === 'youtube' ? 'channel' : 'account'}`}</summary>
      <p className="studio-note mt-2">{notes[platform]}</p>
      {configured === null ? <p role="status">{tr ? 'Bağlantı durumu yükleniyor…' : 'Loading connection status…'}</p> : configured[platform] ? <form onSubmit={event => void connect(event, platform)} className="studio-form-grid mt-3"><fieldset className="studio-form-grid studio-form-full" disabled={Boolean(busy)}>
        <label>{tr ? 'Hesap adı' : 'Account name'}<input name="accountName" required maxLength={160} autoComplete="off" /></label>
        {platform === 'pinterest' && <label>{tr ? 'Pano kimliği' : 'Board id'}<input name="boardId" required inputMode="numeric" pattern="\d{1,30}" maxLength={30} autoComplete="off" /></label>}
        <div className="studio-form-actions studio-form-full"><button className="studio-secondary"><Link2 size={16} />{busy === platform ? (tr ? 'Bağlanıyor…' : 'Connecting…') : (tr ? `${NAMES[platform]} ile bağlan` : `Connect with ${NAMES[platform]}`)}</button></div>
      </fieldset></form> : <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{tr ? `${NAMES[platform]} uygulaması sunucuda yapılandırılmadı.` : `The ${NAMES[platform]} app is not configured on the server.`}</p>}
    </details>)}
  </>;
}
