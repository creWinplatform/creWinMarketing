'use client';
import { useEffect, useState } from 'react';
import { CalendarCheck, ExternalLink } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { CoachWeeklyPackView } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

// Monday pack: once a week the coach drafts this week's content plan items for the team to read, edit and approve.
// Off until an approver turns it on, because every draft uses one AI use; nothing is published or scheduled.
export default function CoachWeeklyPack({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [view, setView] = useState<CoachWeeklyPackView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); projectRequest<CoachWeeklyPackView>('/api/platform/coach?view=weekly', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(setView).catch(() => {}); return () => controller.abort(); }, []);
  if (!view?.available) return null;
  const toggle = async () => {
    if (busy) return; setBusy(true); setError('');
    try { setView(await projectRequest<CoachWeeklyPackView>('/api/platform/coach', { method: 'POST', body: JSON.stringify({ action: 'weekly_pack', enabled: !view.enabled }), signal: AbortSignal.timeout(15000) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'İstek tamamlanamadı.' : 'Request failed.')); }
    finally { setBusy(false); }
  };
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const notes: Record<string, [string, string]> = {
    ai_unavailable: ['AI yapılandırılmadığı için taslak yerine düzenlenecek çerçeveler hazırlandı.', 'AI isn’t configured, so frames to edit were prepared instead of drafts.'],
    ai_quota: ['AI hakkı bittiği için bazı maddelere çerçeve hazırlandı.', 'The AI quota ran out, so some items got frames instead.'],
    ai_failed: ['Bazı AI taslakları hazırlanamadı; o maddelere çerçeve kondu ve AI hakkı iade edildi.', 'Some AI drafts failed; those items got frames and the AI use was refunded.'],
    content_limit: ['İçerik kayıt sınırına ulaşıldı.', 'The content limit was reached.'],
    no_brief: ['Onaylı strateji briefi olmadığı için hazırlanmadı.', 'Not prepared: there is no approved strategy brief.'],
    no_rights: ['Paketi açan üyenin içerik yazma yetkisi kalmadığı için hazırlanmadı.', 'Not prepared: the member who turned it on can no longer write content.'],
    failed: ['Hazırlanamadı.', 'Could not be prepared.'],
  };
  return <div className="coach-weekly-pack">
    <p><CalendarCheck size={15} aria-hidden="true" /><strong>{tr ? 'Pazartesi paketi' : 'Monday pack'}</strong> · {view.enabled
      ? (tr ? 'Açık: her pazartesi sabahı bu haftanın içerik planı maddeleri için en çok 3 taslak hazırlanır.' : 'On: every Monday morning up to 3 drafts are prepared for this week’s content plan items.')
      : (tr ? 'Kapalı. Açarsanız her pazartesi bu haftanın içeriklerinin taslakları hazır gelir; siz okuyup onaylarsınız.' : 'Off. When on, this week’s content drafts are ready every Monday; you read and approve them.')}</p>
    {view.readyThisWeek > 0 && <p><a className="studio-text-button" href="/?tab=library">{tr ? `Bu haftanın ${view.readyThisWeek} taslağı kütüphanede hazır` : `${view.readyThisWeek} draft(s) for this week are ready in the library`}<ExternalLink size={13} /></a></p>}
    {view.lastRunAt && <p className="coach-muted">{tr ? `Son hazırlık: ${date(view.lastRunAt)} · ${view.lastDrafts} taslak (${view.lastAi} AI ile)` : `Last prepared: ${date(view.lastRunAt)} · ${view.lastDrafts} draft(s) (${view.lastAi} with AI)`}{view.note && notes[view.note] ? ` · ${notes[view.note][tr ? 0 : 1]}` : ''}</p>}
    <details className="coach-weekly-pack-more"><summary>{tr ? 'Nasıl çalışır?' : 'How does it work?'}</summary><p className="coach-muted">{tr ? `Her taslak bir AI hakkı kullanır (haftada en çok 3). Hiçbir şey kendiliğinden yayınlanmaz veya zamanlanmaz.${view.aiConfigured ? '' : ' Bu sunucuda AI yapılandırılmadı; taslak yerine çerçeve hazırlanır.'}` : `Each draft uses one AI use (at most 3 a week). Nothing is published or scheduled on its own.${view.aiConfigured ? '' : ' AI isn’t configured on this server; frames are prepared instead of drafts.'}`}</p></details>
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}
    {view.canManage ? <button type="button" className="studio-secondary" disabled={busy} onClick={() => void toggle()}>{view.enabled ? (tr ? 'Pazartesi paketini kapat' : 'Turn the Monday pack off') : (tr ? 'Pazartesi paketini aç' : 'Turn the Monday pack on')}</button>
      : !view.enabled && <p className="coach-muted">{tr ? 'Paketi onay yetkisi olan bir ekip üyesi açabilir.' : 'A teammate who can approve can turn it on.'}</p>}
    {view.enabled && view.enabledBy && <p className="coach-muted">{tr ? `Açan: ${view.enabledBy}` : `Turned on by ${view.enabledBy}`}</p>}
  </div>;
}
