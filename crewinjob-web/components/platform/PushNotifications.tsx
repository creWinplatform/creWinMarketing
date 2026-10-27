'use client';
import { useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import Msg from '@/components/Msg';

type PushView = { enabled: boolean; publicKey: string | null; subscribed: boolean };
const key = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
// Phone notifications for this browser: a fixed notice that something new needs the person in one of their projects.
// Nothing about the project travels with the notification.
export default function PushNotifications({ lang }: { lang: Locale }) {
  const tr = lang === 'tr';
  const [view, setView] = useState<PushView | null>(null), [supported, setSupported] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(false);
  const registration = () => navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  useEffect(() => {
    mounted.current = true;
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (ok) void (async () => {
      try {
        const config = await projectRequest<PushView>('/api/platform/push');
        const existing = config.enabled ? await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription() : null;
        const status = existing ? await projectRequest<PushView>('/api/platform/push', { method: 'POST', body: JSON.stringify({ action: 'status', endpoint: existing.endpoint }) }) : config;
        if (mounted.current) setView(status);
      } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : tr ? 'Bildirim ayarı alınamadı.' : 'Could not load notification settings.'); }
    })();
    return () => { mounted.current = false; };
  }, [tr]);
  async function toggle() {
    if (busy || !view?.publicKey) return; setBusy(true); setError('');
    try {
      const worker = await registration(), current = await worker.pushManager.getSubscription();
      if (view.subscribed && current) {
        const next = await projectRequest<PushView>('/api/platform/push', { method: 'POST', body: JSON.stringify({ action: 'unsubscribe', endpoint: current.endpoint }) });
        await current.unsubscribe().catch(() => false);
        if (mounted.current) setView(next);
        return;
      }
      if (await Notification.requestPermission() !== 'granted') throw new Error(tr ? 'Bildirim izni verilmedi. Tarayıcı ayarlarından bu siteye izin verebilirsiniz.' : 'Notification permission was not granted. You can allow it for this site in the browser settings.');
      const subscription = current || await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(view.publicKey) });
      const next = await projectRequest<PushView>('/api/platform/push', { method: 'POST', body: JSON.stringify({ action: 'subscribe', endpoint: subscription.endpoint }) });
      if (mounted.current) setView(next);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!supported) return <p className="studio-note">{tr ? 'Bu tarayıcı telefon bildirimlerini desteklemiyor. iPhone’da önce Ryzevo’yu Ana Ekrana ekleyin.' : 'This browser does not support phone notifications. On iPhone, add Ryzevo to the Home Screen first.'}</p>;
  if (!view?.enabled) return error ? <p role="alert" className="studio-error"><Msg text={error} /></p> : null;
  return <div className="team-alert-email">
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}
    <p className="studio-note">{view.subscribed
      ? (tr ? 'Bu cihaza, projelerinizden birinde yeni bir uyarı veya onay bekleyen bir iş çıktığında bildirim gelir (en fazla 30 dakikada bir). Bildirimde proje, kişi veya mesaj bilgisi yer almaz.' : 'This device is notified when a new alert or decision comes up in one of your projects (at most every 30 minutes). The notification names no project, person or message.')
      : (tr ? 'Telefonunuza bildirim almak için bu cihazda açın. iPhone’da önce Ryzevo’yu Ana Ekrana ekleyin.' : 'Turn this on to get notifications on this device. On iPhone, add Ryzevo to the Home Screen first.')}</p>
    <button type="button" className="studio-secondary" disabled={busy} aria-pressed={view.subscribed} onClick={() => void toggle()}><Smartphone size={15} />{view.subscribed ? (tr ? 'Bu cihazda bildirimleri kapat' : 'Turn off notifications on this device') : (tr ? 'Bu cihazda bildirimleri aç' : 'Turn on notifications on this device')}</button>
  </div>;
}
