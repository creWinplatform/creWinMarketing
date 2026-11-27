'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, CircleDot, Coins, Inbox, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import Msg from '@/components/Msg';
import { MANAGED_STAGES, MANAGED_WAIT, type ManagedSnapshot } from '@/lib/platform/managed-sending-types';

// Managed sales service, the customer's screen: four stages instead of an empty waiting screen, the domain Ryzevo set
// aside for this company (approved by its authorised person), credits and the result that matters: the cost per
// interested reply.
export default function ManagedSendingPanel({ tr }: { tr: boolean }) {
  const t = (a: string, b: string) => tr ? a : b, idx = tr ? 0 : 1;
  const [data, setData] = useState<ManagedSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false);
  const load = useCallback(() => { projectRequest<ManagedSnapshot>('/api/platform/prospects/managed').then(setData).catch(() => setData(null)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  if (!data.pilot) return <details className="studio-band managed-panel is-intro">
    <summary><Sparkles size={15} aria-hidden="true" /><strong>{t('Kurulumsuz satış gönderimi (pilot)', 'Sales sending without setup (pilot)')}</strong><span className="sales-badge">{t('Yakında', 'Coming soon')}</span></summary>
    <p className="coach-muted">{t('Ryzevo size özel bir alan adı ayırır, gönderimi ve yanıtları yönetir; siz DNS, AWS veya posta kutusu kurmazsınız. Şimdilik az sayıda doğrulanmış şirketle pilot olarak yürüyor. Bu sırada satış e-postaları aşağıdaki ayarlarla kendi göndericinizden gider.', 'Ryzevo sets aside a domain for you and runs the sending and the replies; you set up no DNS, AWS or mailbox. For now it runs as a pilot with a few verified companies. Meanwhile sales emails go from your own sender with the settings below.')}</p>
  </details>;
  const approve = async () => { setBusy(true); setError('');
    try { setData(await projectRequest<ManagedSnapshot>('/api/platform/prospects/managed', { method: 'POST', body: JSON.stringify({ action: 'approve', domainId: data.domain?.id, accepted: true, version: data.terms.version }) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); } finally { setBusy(false); } };
  const money = (value: number) => `$${value.toFixed(2)}`;
  return <section className="studio-band managed-panel" aria-labelledby="managed-title">
    <div className="finder-head"><h2 id="managed-title"><ShieldCheck size={16} aria-hidden="true" />{t('Yönetimli satış gönderimi', 'Managed sales sending')}</h2>
      <span className={`sales-badge ${data.ready ? 'is-ok' : 'is-warn'}`}>{data.ready ? t('Gönderime hazır', 'Ready to send') : data.waiting ? MANAGED_WAIT[data.waiting][idx] : ''}</span></div>
    {data.pilot.state === 'suspended' && <p className="sales-paused" role="alert">{t('Gönderim durduruldu', 'Sending is stopped')}: {data.pilot.suspendedReason}</p>}
    {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
    <ol className="managed-stages">{data.stages.map(stage => <li key={stage.key} className={`is-${stage.state}`}>
      {stage.state === 'done' ? <Check size={15} aria-hidden="true" /> : <CircleDot size={15} aria-hidden="true" />}
      <div><strong>{MANAGED_STAGES[stage.key].label[idx]}</strong><p className="coach-muted">{stage.note || MANAGED_STAGES[stage.key].detail[idx]}</p></div></li>)}</ol>
    {data.domain && <div className="managed-sender">
      <p>{t('Gönderen', 'Sender')}: <strong>{data.domain.fromName}</strong> &lt;{data.domain.fromAddress}&gt; · {t('şirket', 'company')}: {data.domain.companyName}</p>
      <p className="coach-muted">{t('Bu alan adı yalnız sizin için ayrıldı; başka bir müşteriyle paylaşılmaz.', 'This domain is set aside only for you; it is never shared with another customer.')}{data.domain.renewsOn ? t(` Yenileme: ${data.domain.renewsOn}.`, ` Renews on ${data.domain.renewsOn}.`) : ''} {data.domain.registrant === 'customer' ? t('Alan adı şirketiniz adına kayıtlı.', 'The domain is registered to your company.') : t('Alan adı Ryzevo adına kayıtlı ve sizin için yönetiliyor.', 'The domain is registered to Ryzevo and managed for you.')}</p>
      {!data.domain.approvedAt && (data.canApprove ? <div className="sales-approve">
        <p className="sales-message">{data.terms.text[idx]}</p>
        <label className="design-toggle"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />{t('Şirketimiz adına bu yetkiyi veriyorum.', 'I give this authority on behalf of our company.')}</label>
        <button type="button" className="studio-primary" disabled={!accepted || busy} onClick={() => void approve()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t('Yetkiyi onayla', 'Approve')}</button>
      </div> : <p className="coach-muted">{t('Gönderim yetkisini projenin sahibi onaylar.', 'The project owner approves the sending authority.')}</p>)}
      {data.domain.approvedAt && <p className="coach-muted"><Check size={13} aria-hidden="true" /> {t('Şirket adına gönderim yetkisi onaylandı', 'Sending authority approved')} · {new Date(data.domain.approvedAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB')}</p>}
    </div>}
    <div className="managed-figures">
      <div><Coins size={15} aria-hidden="true" /><strong>{data.credits.balance}</strong><span>{t('kalan kredi (1 kredi = 1 e-posta)', 'credits left (1 credit = 1 email)')}</span></div>
      <div><strong>{data.results.sent}</strong><span>{t('gönderilen e-posta', 'emails sent')}</span></div>
      <div><strong>{data.results.interested}</strong><span>{t('ilgilenen yanıt', 'interested replies')}</span></div>
      <div><strong>{data.results.costPerInterestedUsd !== null ? money(data.results.costPerInterestedUsd) : '—'}</strong><span>{t('ilgilenen yanıt başına maliyet', 'cost per interested reply')}</span></div>
    </div>
    <p className="coach-muted">{t(`Bu ay ${data.credits.usedThisMonth} kredi kullanıldı.${data.credits.priceUsd ? ` Pilot fiyatı e-posta başına ${money(data.credits.priceUsd)}.` : ''} ${data.credits.followUpsCharged ? 'Takip e-postaları da kredi kullanır.' : 'Takip e-postaları kredi kullanmaz.'} Gönderimden önce elenen adaylar (engelli, İYS reddi, geçersiz adres) kredi kullanmaz; sağlayıcının reddettiği e-postanın kredisi iade edilir.`, `${data.credits.usedThisMonth} credits used this month.${data.credits.priceUsd ? ` Pilot price ${money(data.credits.priceUsd)} per email.` : ''} ${data.credits.followUpsCharged ? 'Follow-ups use credits too.' : 'Follow-ups use no credits.'} Candidates left out before sending (blocked, rejected in İYS, invalid address) use none; an email the provider refuses is refunded.`)}</p>
    {data.canRead && data.inbound.length > 0 && <details className="sales-section"><summary><Inbox size={14} aria-hidden="true" />{t(`Son yanıtlar (${data.inbound.length})`, `Latest replies (${data.inbound.length})`)}</summary>
      <ul className="managed-inbound">{data.inbound.slice(0, 8).map(item => <li key={item.id}><strong>{item.from}</strong> · {item.subject}<span className="coach-muted"> · {new Date(item.receivedAt).toLocaleString(tr ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><p>{item.text.slice(0, 280)}{item.text.length > 280 ? '…' : ''}</p></li>)}</ul>
      <p className="coach-muted">{t('Yanıtlar size e-postayla da iletilir ve 30 gün saklanır. Cevabı kendi e-postanızdan doğrudan kişiye yazın.', 'Replies are also passed to you by email and kept for 30 days. Answer the person directly from your own mailbox.')}</p></details>}
  </section>;
}
