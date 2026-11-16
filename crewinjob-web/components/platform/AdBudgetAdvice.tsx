'use client';
import { useState } from 'react';
import { Gauge, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import type { BudgetSuggestion } from '@/lib/platform/ad-optimizer';
import Msg from '@/components/Msg';

// A daily budget hint from the plan's own figures. Applying it needs an approver, stays inside the project's caps,
// is checked by the provider without changing anything first, and is off unless the server allows it.
export default function AdBudgetAdvice({ planId, provider, tr, canApply, money, onApplied }: { planId: string; provider: 'meta' | 'google'; tr: boolean; canApply: boolean; money: (minor: number) => string; onApplied: () => void }) {
  const t = (a: string, b: string) => tr ? a : b;
  const [value, setValue] = useState<BudgetSuggestion | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [ack, setAck] = useState(false), [done, setDone] = useState('');
  const call = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError(''); setDone('');
    try { const result = await projectRequest<BudgetSuggestion>('/api/platform/ads/optimize', { method: 'POST', body: JSON.stringify({ ...body, provider, id: planId }), signal: AbortSignal.timeout(45000) }); setValue(result); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('İstek tamamlanamadı.', 'Request failed.')); return null; } finally { setBusy(''); }
  };
  return <div className="ads-creatives ads-budget">
    <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void call('read', { action: 'budget' })}>{busy === 'read' ? <Loader2 size={15} className="animate-spin" /> : <Gauge size={15} />}{t('Bütçe önerisi', 'Budget suggestion')}</button>
    {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
    {value && <div className="ads-creatives-body" role="status">
      <p className="ads-budget-line">{value.change === 'increase' ? <TrendingUp size={16} /> : value.change === 'decrease' ? <TrendingDown size={16} /> : <Gauge size={16} />}
        {value.change === 'keep' ? t(`Günlük ${money(value.currentMinor)} uygun görünüyor.`, `${money(value.currentMinor)} a day looks right.`) : t(`Günlük ${money(value.currentMinor)} → ${money(value.suggestedMinor)} önerilir.`, `Suggested: ${money(value.currentMinor)} → ${money(value.suggestedMinor)} a day.`)}</p>
      <ul className="coach-muted ads-budget-reasons">{value.reasons.map(reason => <li key={reason}><Msg text={reason} /></li>)}</ul>
      {value.change !== 'keep' && (canApply && value.applyEnabled ? <div className="automation-approve">
        <label className="automation-choice"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{t(`Bu planın günlük bütçesinin ${money(value.suggestedMinor)} olmasını onaylıyorum.`, `I approve a daily budget of ${money(value.suggestedMinor)} for this plan.`)}</label>
        <button type="button" className="studio-secondary" disabled={!ack || Boolean(busy)} onClick={() => void call('apply', { action: 'apply-budget', dailyBudgetMinor: value.suggestedMinor, acknowledged: true }).then(result => { if (result) { setAck(false); setDone(t('Sağlayıcı önce doğruladı, sonra yeni bütçeyi kabul etti.', 'The provider checked and then accepted the new budget.')); onApplied(); } })}>{busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : null}{t('Bütçeyi uygula', 'Apply budget')}</button>
      </div> : <p className="coach-muted">{value.applyEnabled ? t('Bütçeyi onay yetkisi olan ekip üyeleri değiştirebilir.', 'Teammates with approval rights can change the budget.') : t('Bütçe değişikliği bu sunucuda kapalı; öneriyi reklam hesabından uygulayabilirsiniz.', 'Budget changes are off on this server; you can apply the suggestion in the ad account.')}</p>)}
      {done && <p className="coach-note">{done}</p>}
    </div>}
  </div>;
}
