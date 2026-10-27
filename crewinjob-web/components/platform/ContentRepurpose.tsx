'use client';
import { useState } from 'react';
import { Shuffle } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';

const CHANNELS = ['linkedin', 'facebook', 'instagram', 'twitter', 'telegram'];
const NAMES: Record<string, string> = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', telegram: 'Telegram' };
// Adapts one saved draft for other channels. Every version becomes its own draft in this list; nothing is published.
export default function ContentRepurpose({ id, platform, lang, disabled, onDone }: { id: string; platform: string; lang: Locale; disabled: boolean; onDone: (message: string) => void }) {
  const tr = lang === 'tr', targets = CHANNELS.filter(channel => channel !== platform);
  const [open, setOpen] = useState(false), [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (mode: 'ai' | 'template') => {
    setBusy(true); setError('');
    try {
      const data = await projectRequest<{ created: { id: string; platform: string }[] }>('/api/platform/repurpose', { method: 'POST', body: JSON.stringify({ sourceId: id, channels: picked, mode }) });
      setOpen(false); setPicked([]);
      onDone(tr ? `${data.created.length} yeni taslak oluşturuldu (${data.created.map(item => NAMES[item.platform]).join(', ')}). Yayından önce okuyup düzenleyin.` : `${data.created.length} new drafts created (${data.created.map(item => NAMES[item.platform]).join(', ')}). Read and edit them before publishing.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.'); }
    finally { setBusy(false); }
  };
  if (!open) return <button className="studio-text-button" disabled={disabled} onClick={() => setOpen(true)}><Shuffle size={16} />{tr ? 'Diğer kanallara uyarla' : 'Adapt for other channels'}</button>;
  return (
    <div className="repurpose-box" role="group" aria-label={tr ? 'Diğer kanallara uyarla' : 'Adapt for other channels'}>
      <p className="studio-note">{tr ? 'Her kanal için ayrı bir taslak oluşur; hiçbir şey yayınlanmaz veya zamanlanmaz.' : 'Each channel gets its own draft; nothing is published or scheduled.'}</p>
      <div className="repurpose-channels">
        {targets.map(channel => <label key={channel} className="repurpose-channel"><input type="checkbox" checked={picked.includes(channel)} disabled={busy} onChange={event => setPicked(event.target.checked ? [...picked, channel] : picked.filter(value => value !== channel))} />{NAMES[channel]}</label>)}
      </div>
      {error && <p className="studio-error" role="alert">{error}</p>}
      <div className="repurpose-actions">
        <button className="studio-primary" disabled={busy || !picked.length} onClick={() => void run('ai')}>{busy ? (tr ? 'Hazırlanıyor…' : 'Preparing…') : tr ? 'AI ile uyarla' : 'Adapt with AI'}</button>
        <button className="studio-secondary" disabled={busy || !picked.length} onClick={() => void run('template')}>{tr ? 'Kurallarla uyarla' : 'Adapt by rules'}</button>
        <button className="studio-text-button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>{tr ? 'Vazgeç' : 'Cancel'}</button>
      </div>
      <p className="studio-note">{tr ? 'Kurallarla uyarlama metni değiştirmez: X için kısaltır, Instagram için bağlantıları çıkarıp yerine yazmanız gereken bir not bırakır.' : 'Adapting by rules keeps your words: it shortens for X, and for Instagram it removes links and leaves a note for you to fill in.'}</p>
    </div>
  );
}
