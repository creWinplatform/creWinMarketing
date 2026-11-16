'use client';
import { useEffect, useState } from 'react';
import { PauseCircle } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import type { AdsSnapshot } from '@/lib/platform/ad-types';

type View = NonNullable<NonNullable<AdsSnapshot['alerts']>['autoPause']>;
// The opt-in automatic pause next to the spend thresholds: off by default, on only with an explicit acknowledgement.
export default function AdAutoPausePanel({ lang, value, busy, planName, money, onSave }: {
  lang: Locale; value: View; busy: boolean; planName: (id: string) => string; money: (minor: number, currency: string) => string;
  onSave: (input: { enabled: boolean; kinds: ('overspend' | 'cpi')[]; acknowledged: boolean }) => void;
}) {
  const tr = lang === 'tr', locale = tr ? 'tr-TR' : 'en-GB';
  const [kinds, setKinds] = useState(value.kinds), [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { setKinds(value.kinds); setAcknowledged(false); }, [value]);
  const toggle = (kind: 'overspend' | 'cpi') => setKinds(old => old.includes(kind) ? old.filter(item => item !== kind) : [...old, kind]);
  const when = (at: string) => new Date(at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="ads-auto-pause" aria-labelledby="ads-auto-pause-title">
      <h3 className="ads-form-title" id="ads-auto-pause-title"><PauseCircle size={16} aria-hidden="true" />{tr ? 'Otomatik duraklatma' : 'Automatic pause'}<span className={`coach-state ${value.enabled ? 'ads-auto-on' : ''}`}>{value.enabled ? (tr ? 'Açık' : 'On') : (tr ? 'Kapalı' : 'Off')}</span></h3>
      <p className="coach-muted">{tr ? 'Açıkken, yayındaki bir plan seçtiğiniz eşiği aşınca Ryzevo planı sizin adınıza duraklatır (en geç 15 dakika içinde). Yalnız duraklatır: başlatmaz, bütçeyi değiştirmez. Açan kişinin reklam onay ve bağlantı yetkisi kalkarsa kendiliğinden kapanır.' : 'When on, Ryzevo pauses a running plan on your behalf once it passes the threshold you choose (within 15 minutes). It only pauses: it never starts a plan or changes a budget. It switches itself off if the person who turned it on loses the ad approval or connection rights.'}</p>
      <fieldset className="ads-auto-kinds"><legend className="sr-only">{tr ? 'Duraklatma eşikleri' : 'Pause thresholds'}</legend>
        <label><input type="checkbox" checked={kinds.includes('overspend')} onChange={() => toggle('overspend')} disabled={busy} />{tr ? 'Bütçe aşım eşiği aşılınca' : 'When the overspend threshold is passed'}</label>
        <label><input type="checkbox" checked={kinds.includes('cpi')} onChange={() => toggle('cpi')} disabled={busy} />{tr ? 'Yükleme başına maliyet sınırı aşılınca' : 'When the cost-per-install cap is passed'}</label>
      </fieldset>
      {!value.enabled && <label className="ads-auto-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} />{tr ? 'Anladım: eşik aşıldığında Ryzevo bu projedeki yayındaki reklam planlarını benim yetkimle duraklatabilir.' : 'I understand: when a threshold is passed, Ryzevo may pause this project’s running ad plans with my rights.'}</label>}
      <div className="ads-auto-actions">
        {value.enabled ? <>
          <button type="button" className="studio-secondary" disabled={busy || !kinds.length} onClick={() => onSave({ enabled: true, kinds, acknowledged: true })}>{tr ? 'Eşikleri güncelle' : 'Update thresholds'}</button>
          <button type="button" className="studio-secondary" disabled={busy} onClick={() => onSave({ enabled: false, kinds, acknowledged: false })}>{tr ? 'Kapat' : 'Turn off'}</button>
        </> : <button type="button" className="studio-primary" disabled={busy || !kinds.length || !acknowledged} onClick={() => onSave({ enabled: true, kinds, acknowledged })}>{tr ? 'Otomatik duraklatmayı aç' : 'Turn on automatic pause'}</button>}
        {value.enabled && value.enabledAt && <span className="coach-muted">{value.enabledByMe ? (tr ? `Sizin adınıza açık (${when(value.enabledAt)})` : `On with your rights (${when(value.enabledAt)})`) : (tr ? `Bir ekip üyesi açtı (${when(value.enabledAt)})` : `Turned on by a team member (${when(value.enabledAt)})`)}</span>}
      </div>
      {value.recent.length > 0 && <ul className="ads-auto-log" aria-label={tr ? 'Son otomatik duraklatmalar' : 'Recent automatic pauses'}>{value.recent.map(item => <li key={`${item.planId}-${item.at}`}>
        <b>{planName(item.planId)}</b> · {item.outcome === 'paused' ? (tr ? 'duraklatıldı' : 'paused') : (tr ? 'duraklatılamadı, hesabı kontrol edin' : 'could not be paused, check the account')} · {item.kind === 'cpi' ? 'CPI' : (tr ? 'bütçe aşımı' : 'overspend')} {money(item.spendMinor, item.currency)} / {money(item.limitMinor, item.currency)} · {when(item.at)}
      </li>)}</ul>}
    </section>
  );
}
