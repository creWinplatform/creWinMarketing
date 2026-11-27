'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Globe, Loader2, Pause, Play, Plus, ShieldCheck, Unlink } from 'lucide-react';
import Msg from '@/components/Msg';
import type { ManagedOperatorSnapshot } from '@/lib/platform/managed-sending-types';

// Operator console, managed sales service: the pilot companies (at most ten, each verified by a person), their
// credits and health, and the managed domains (one customer each, never reused).
export default function ManagedOperatorPanel({ tr }: { tr: boolean }) {
  const t = (a: string, b: string) => tr ? a : b;
  const [data, setData] = useState<ManagedOperatorSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [pilot, setPilot] = useState({ project: '', companyName: '', dailyCap: '25', note: '', verified: false });
  const [domain, setDomain] = useState({ domain: '', fromLocal: '', fromName: '', registrant: 'ryzevo', renewsOn: '', note: '' });
  const [credit, setCredit] = useState<Record<string, string>>({}), [assign, setAssign] = useState<Record<string, string>>({}), [reason, setReason] = useState<Record<string, string>>({});
  const load = useCallback(() => { fetch('/api/platform/operator/managed', { cache: 'no-store' }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); }).catch(reason => setError(reason instanceof Error ? reason.message : '')); }, []);
  useEffect(() => { load(); }, [load]);
  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError('');
    try { const response = await fetch('/api/platform/operator/managed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('İşlem tamamlanamadı.', 'Request failed.')); return false; } finally { setBusy(''); }
  };
  if (!data) return error ? <section className="plan-section"><h3>{t('Yönetimli satış gönderimi', 'Managed sales sending')}</h3><p className="coach-muted"><Msg text={error} /></p></section> : null;
  const projectOf = (value: string) => { const [organizationId, projectId] = value.split('|'); return { organizationId, projectId }; };
  const addPilot = async (event: FormEvent) => { event.preventDefault(); if (await post('pilot', { action: 'pilot', ...projectOf(pilot.project), companyName: pilot.companyName, dailyCap: Number(pilot.dailyCap), note: pilot.note, verified: pilot.verified })) setPilot({ project: '', companyName: '', dailyCap: '25', note: '', verified: false }); };
  const addDomain = async (event: FormEvent) => { event.preventDefault(); if (await post('domain', { action: 'domain-add', ...domain })) setDomain({ domain: '', fromLocal: '', fromName: '', registrant: 'ryzevo', renewsOn: '', note: '' }); };
  const free = data.domains.filter(item => item.state === 'available'), active = data.pilots.filter(item => item.state === 'active').length;
  return <section className="plan-section managed-operator" aria-labelledby="managed-operator-title">
    <div className="plan-section-heading"><h3 id="managed-operator-title"><ShieldCheck size={16} aria-hidden="true" /> {t('Yönetimli satış gönderimi (pilot)', 'Managed sales sending (pilot)')}</h3>
      <p className="coach-muted">{t(`Anahtar: ${data.switchOn ? 'açık' : 'kapalı'} (PLATFORM_MANAGED_SENDING_ENABLED) · sağlayıcı: ${data.provider || 'yok'} · yanıt girişi: ${data.inboundConfigured ? 'var' : 'yok'} · ${active}/${data.maxPilots} pilot`, `Switch: ${data.switchOn ? 'on' : 'off'} (PLATFORM_MANAGED_SENDING_ENABLED) · provider: ${data.provider || 'none'} · replies: ${data.inboundConfigured ? 'set up' : 'not set up'} · ${active}/${data.maxPilots} pilots`)}</p></div>
    {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
    <div className="managed-table"><table><thead><tr><th>{t('Proje / şirket', 'Project / company')}</th><th>{t('Durum', 'State')}</th><th>{t('Alan adı', 'Domain')}</th><th>{t('Kredi', 'Credits')}</th><th>{t('14 gün', '14 days')}</th><th>{t('İşlem', 'Actions')}</th></tr></thead>
      <tbody>{data.pilots.map(row => { const key = `${row.organizationId}|${row.projectId}`; return <tr key={key}>
        <td><strong>{row.projectName}</strong><br /><span className="coach-muted">{row.companyName} · {t(`günlük en çok ${row.dailyCap}`, `at most ${row.dailyCap}/day`)}</span></td>
        <td>{row.state === 'active' ? t('Etkin', 'Active') : <>{t('Durduruldu', 'Stopped')}<br /><span className="coach-muted">{row.suspendedReason}</span></>}</td>
        <td>{row.domain ? <>{row.domain}<br /><span className="coach-muted">{row.domainApproved ? t('müşteri onayladı', 'approved by the customer') : t('müşteri onayı bekleniyor', 'awaiting the customer')}</span></> : <select aria-label={t('Alan adı ata', 'Assign a domain')} value={assign[key] || ''} onChange={event => setAssign({ ...assign, [key]: event.target.value })}><option value="">{t('Alan adı seçin', 'Choose a domain')}</option>{free.map(item => <option key={item.id} value={item.id}>{item.domain}</option>)}</select>}
          {!row.domain && assign[key] && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`assign-${key}`, { action: 'domain-assign', domainId: assign[key], organizationId: row.organizationId, projectId: row.projectId })}><Globe size={13} />{t('Ata', 'Assign')}</button>}</td>
        <td>{row.balance}<div className="sales-inline"><input aria-label={t('Kredi miktarı', 'Credit amount')} inputMode="numeric" placeholder="+500" value={credit[key] || ''} onChange={event => setCredit({ ...credit, [key]: event.target.value.replace(/[^\d-]/g, '') })} />
          <button type="button" className="studio-text-button" disabled={Boolean(busy) || !credit[key]} onClick={() => void post(`credit-${key}`, { action: 'credits', organizationId: row.organizationId, projectId: row.projectId, amount: Number(credit[key]), kind: Number(credit[key]) < 0 ? 'adjust' : 'grant', note: 'operator' }).then(ok => { if (ok) setCredit({ ...credit, [key]: '' }); })}><Plus size={13} />{t('Ekle', 'Add')}</button></div></td>
        <td>{t(`${row.sent} e-posta · ${row.bounces} geri dönme · ${row.complaints} şikâyet`, `${row.sent} emails · ${row.bounces} bounces · ${row.complaints} reports`)}</td>
        <td>{row.state === 'active' ? <div className="sales-inline"><input aria-label={t('Durdurma nedeni', 'Reason to stop')} placeholder={t('Neden', 'Reason')} value={reason[key] || ''} onChange={event => setReason({ ...reason, [key]: event.target.value })} />
          <button type="button" className="studio-text-button" disabled={Boolean(busy) || (reason[key] || '').trim().length < 3} onClick={() => void post(`state-${key}`, { action: 'pilot-state', organizationId: row.organizationId, projectId: row.projectId, state: 'suspended', reason: reason[key] })}><Pause size={13} />{t('Durdur', 'Stop')}</button></div>
          : <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => void post(`state-${key}`, { action: 'pilot-state', organizationId: row.organizationId, projectId: row.projectId, state: 'active' })}><Play size={13} />{t('Devam ettir', 'Resume')}</button>}</td>
      </tr>; })}{!data.pilots.length && <tr><td colSpan={6} className="coach-muted">{t('Henüz pilot şirket yok.', 'No pilot companies yet.')}</td></tr>}</tbody></table></div>
    <form className="prospect-form" onSubmit={event => void addPilot(event)}>
      <h4>{t('Pilota şirket ekle', 'Add a pilot company')}</h4>
      <div className="prospect-form-row"><label>{t('Proje', 'Project')}<select required value={pilot.project} onChange={event => setPilot({ ...pilot, project: event.target.value })}><option value="">{t('Seçin', 'Choose')}</option>{data.projects.map(item => <option key={item.projectId} value={`${item.organizationId}|${item.projectId}`}>{item.organization} · {item.name}</option>)}</select></label>
        <label>{t('Şirketin resmi adı (gönderen kimliği)', 'Company legal name (sender identity)')}<input required minLength={2} maxLength={120} value={pilot.companyName} onChange={event => setPilot({ ...pilot, companyName: event.target.value })} /></label></div>
      <div className="prospect-form-row"><label>{t('Günlük üst sınır (en çok 50)', 'Daily cap (at most 50)')}<input type="number" min={1} max={50} value={pilot.dailyCap} onChange={event => setPilot({ ...pilot, dailyCap: event.target.value })} /></label>
        <label>{t('Not (hedef kitle, sözleşme)', 'Note (audience, contract)')}<input maxLength={300} value={pilot.note} onChange={event => setPilot({ ...pilot, note: event.target.value })} /></label></div>
      <label className="design-toggle"><input type="checkbox" checked={pilot.verified} onChange={event => setPilot({ ...pilot, verified: event.target.checked })} />{t('Şirketi ve yetkilisini doğruladım; hedef kitle dar ve hukuki koşullar netleşti.', 'I verified the company and its authorised person; the audience is narrow and the legal conditions are clear.')}</label>
      <button type="submit" className="studio-secondary" disabled={Boolean(busy) || !pilot.verified}>{busy === 'pilot' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{t('Pilota ekle', 'Add to the pilot')}</button>
    </form>
    <h4>{t('Yönetimli alan adları', 'Managed domains')}</h4>
    <div className="managed-table"><table><thead><tr><th>{t('Alan adı', 'Domain')}</th><th>{t('Durum', 'State')}</th><th>{t('Gönderen', 'Sender')}</th><th>{t('Kontrol', 'Check')}</th><th /></tr></thead>
      <tbody>{data.domains.map(row => <tr key={row.id}><td>{row.domain}<br /><span className="coach-muted">{row.registrant === 'customer' ? t('müşteri adına kayıtlı', 'registered to the customer') : t('Ryzevo adına kayıtlı', 'registered to Ryzevo')}{row.renewsOn ? ` · ${row.renewsOn}` : ''}</span></td>
        <td>{row.state === 'available' ? t('Boşta', 'Available') : row.state === 'assigned' ? `${t('Ayrıldı', 'Assigned')}: ${row.projectName || ''}` : t('Bırakıldı (yeniden kullanılmaz)', 'Released (never reused)')}</td>
        <td>{row.fromName ? `${row.fromName} ` : ''}&lt;{row.fromLocal}@{row.domain}&gt;</td>
        <td>{row.verified ? <><Check size={13} aria-label={t('hazır', 'ready')} /> {t('hazır', 'ready')}</> : t('hazır değil', 'not ready')}{row.state !== 'released' && <button type="button" className="studio-text-button" disabled={Boolean(busy) || !data.provider} onClick={() => void post(`check-${row.id}`, { action: 'domain-check', domainId: row.id })}>{t('Kontrol et', 'Check')}</button>}</td>
        <td>{row.state === 'assigned' && <button type="button" className="studio-text-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('Alan adı bırakılsın mı? Süren gönderim durur; alan adı başka müşteriye verilmez.', 'Release the domain? Running sending stops; the domain is never given to another customer.'))) void post(`release-${row.id}`, { action: 'domain-release', domainId: row.id }); }}><Unlink size={13} />{t('Bırak', 'Release')}</button>}</td></tr>)}
        {!data.domains.length && <tr><td colSpan={5} className="coach-muted">{t('Henüz alan adı yok.', 'No domains yet.')}</td></tr>}</tbody></table></div>
    <form className="prospect-form" onSubmit={event => void addDomain(event)}>
      <div className="prospect-form-row"><label>{t('Alan adı', 'Domain')}<input required placeholder="firma-mail.com" value={domain.domain} onChange={event => setDomain({ ...domain, domain: event.target.value })} /></label>
        <label>{t('Gönderen adresi (@ öncesi)', 'Sender address (before @)')}<input required maxLength={40} placeholder="ayse" value={domain.fromLocal} onChange={event => setDomain({ ...domain, fromLocal: event.target.value })} /></label>
        <label>{t('Gönderen adı', 'Sender name')}<input maxLength={80} placeholder="Ayşe · Firma" value={domain.fromName} onChange={event => setDomain({ ...domain, fromName: event.target.value })} /></label></div>
      <div className="prospect-form-row"><label>{t('Kimin adına kayıtlı', 'Registered to')}<select value={domain.registrant} onChange={event => setDomain({ ...domain, registrant: event.target.value })}><option value="customer">{t('Müşteri (önerilen)', 'The customer (recommended)')}</option><option value="ryzevo">Ryzevo</option></select></label>
        <label>{t('Yenileme tarihi', 'Renews on')}<input type="date" value={domain.renewsOn} onChange={event => setDomain({ ...domain, renewsOn: event.target.value })} /></label>
        <label>{t('Not', 'Note')}<input maxLength={300} value={domain.note} onChange={event => setDomain({ ...domain, note: event.target.value })} /></label></div>
      <button type="submit" className="studio-secondary" disabled={Boolean(busy)}><Plus size={14} />{t('Alan adı ekle', 'Add a domain')}</button>
    </form>
  </section>;
}
