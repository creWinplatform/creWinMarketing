'use client';

import { useState } from 'react';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

type PreviewResponse = {
  available: boolean;
  reason?: 'backend_not_ready' | 'backend_error';
  error?: string;
  result?: Record<string, unknown>;
};

export default function LifecycleDraftPanel({ lang }: { lang: 'tr' | 'en' }) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('profile_below_80_after_registration');
  const [dayRule, setDayRule] = useState<1 | 3 | 7 | 14>(3);
  const [channel, setChannel] = useState('email');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const runPreview = async () => {
    setLoading(true); setPreview(null);
    try {
      const res = await fetch('/api/campaigns/lifecycle-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayRule,
          countries: [],
          positions: [],
          profileBuckets: trigger === 'profile_50_79' ? ['mid'] : ['zero', 'low', 'mid'],
        }),
      });
      setPreview(await res.json() as PreviewResponse);
    } catch (error) {
      setPreview({ available: false, reason: 'backend_error', error: error instanceof Error ? error.message : t('Önizleme alınamadı.', "Couldn't load the preview.") });
    } finally { setLoading(false); }
  };

  const result = preview?.result || {};
  const count = result.estimatedRecipients ?? result.exactCount ?? result.totalCount;

  return (
    <section className="border-y border-slate-200 dark:border-slate-700 py-5 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap"><div><h3 className="font-semibold text-slate-800 dark:text-slate-100">{t('Lifecycle otomasyonu', 'Lifecycle automation')}</h3><p className="text-sm text-slate-500 mt-1">{t('Kuralları ve kitleyi taslak olarak doğrulayın.', 'Validate rules and audience as a draft.')}</p></div><span className="text-xs px-2 py-1 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300">{t('TASLAK', 'DRAFT')}</span></div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <label className="text-xs text-slate-500">{t('Otomasyon adı', 'Automation name')}<input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></label>
        <label className="text-xs text-slate-500">{t('Tetikleyici', 'Trigger')}<select value={trigger} onChange={event => setTrigger(event.target.value)} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm"><option value="profile_below_80_after_registration">{t('Kayıt sonrası profil %80 altında', 'Profile below 80% after registration')}</option><option value="inactive_user">{t('Uzun süredir giriş yapmadı', "Hasn't signed in for a long time")}</option><option value="profile_missing_fields">{t('Kritik profil alanları eksik', 'Critical profile fields missing')}</option><option value="opened_not_activated">{t('Mesajı açtı, aktive olmadı', 'Opened the message, not activated')}</option><option value="profile_50_79">{t('Profil %50–79', 'Profile 50–79%')}</option></select></label>
        <label className="text-xs text-slate-500">{t('Bekleme süresi (gün)', 'Delay (days)')}<select value={dayRule} onChange={event => setDayRule(Number(event.target.value) as 1 | 3 | 7 | 14)} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm"><option value={1}>1</option><option value={3}>3</option><option value={7}>7</option><option value={14}>14</option></select></label>
        <label className="text-xs text-slate-500">{t('Kanal', 'Channel')}<select value={channel} onChange={event => setChannel(event.target.value)} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm"><option value="email">{t('E-posta', 'Email')}</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="push">Push</option></select></label>
      </div>
      <label className="text-xs text-slate-500 block">{t('Mesaj taslağı', 'Message draft')}<textarea rows={5} value={message} onChange={event => setMessage(event.target.value)} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" /></label>
      <div className="flex items-center gap-3 flex-wrap"><button type="button" onClick={runPreview} disabled={loading} className="bg-ocean text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">{loading ? t('Hesaplanıyor…', 'Calculating…') : t('Kitleyi önizle', 'Preview audience')}</button><button type="button" disabled title={t('Backend feature flag açıldığında kullanılabilir.', 'Available when the backend feature flag is enabled.')} className="border border-slate-300 dark:border-slate-700 text-slate-400 px-4 py-2 rounded-lg text-sm cursor-not-allowed">{t('Taslağı kaydet', 'Save draft')}</button><span className="text-xs text-slate-400">{t('Otomatik gönderim kapalıdır.', 'Automatic sending is disabled.')}</span></div>
      {preview?.available && <div className="border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">{count === undefined ? t('Kitle önizlemesi hazır.', 'Audience preview is ready.') : `${t('Tahmini erişim', 'Estimated reach')}: ${Number(count).toLocaleString(localeTag(lang))}`}</div>}
      {preview?.reason === 'backend_not_ready' && <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">{t('Lifecycle önizleme servisi backend yayını bekliyor.', 'Lifecycle preview is waiting for the backend release.')}</div>}
      {preview?.reason === 'backend_error' && <div className="border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">{preview.error ? <Msg text={preview.error} /> : t('Önizleme alınamadı.', "Couldn't load the preview.")}</div>}
    </section>
  );
}
