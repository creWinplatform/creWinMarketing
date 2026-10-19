'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/lib/platform/catalog';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';

type Member = { id: string; username: string; role: string; active: number };
export default function TeamAdministration({ lang, canProvision,inviteOnly=false }: { lang: Locale; canProvision: boolean;inviteOnly?:boolean }) {
  const tr = lang === 'tr';
  const failed = tr ? 'İstek tamamlanamadı.' : 'Request failed.';
  // Rol anahtarları API'ye olduğu gibi gider; yalnız görünen ad çevrilir.
  const roleLabels: Record<string, string> = tr
    ? { owner: 'Sahip', admin: 'Yönetici', editor: 'Editör', analyst: 'Analist', viewer: 'Görüntüleyici' }
    : { owner: 'Owner', admin: 'Admin', editor: 'Editor', analyst: 'Analyst', viewer: 'Viewer' };
  const [members, setMembers] = useState<Member[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const response = await fetch('/api/platform/members', { cache: 'no-store' });
    if (response.status === 403) { setAllowed(false); return; }
    if (!response.ok) throw new Error(tr ? 'Ekip yüklenemedi.' : 'Could not load team.');
    const data = await response.json();
    setMembers(data.items); setAllowed(true);
  };
  useEffect(() => { void load().catch(reason => setError(reason instanceof Error && reason.message ? reason.message : failed)); }, []);
  const submit = async (event: FormEvent<HTMLFormElement>, organization: boolean) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(organization ? '/api/platform/organizations' : '/api/platform/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      form.reset();
      setMessage(organization ? (tr ? 'Organizasyon ve kullanıcı oluşturuldu. Kullanıcı kendi hesabıyla giriş yapabilir.' : 'Organization and user created. The user can sign in with their own account.') : (tr ? 'Ekip üyesi oluşturuldu.' : 'Team member created.'));
      if (!organization) await load();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { setBusy(false); }
  };
  const update = async (member: Member, role: string, active: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/platform/members', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.id, role, active }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failed);
      await load();
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { setBusy(false); }
  };
  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  return <section className={`space-y-4 border-t border-slate-200 pt-5 dark:border-slate-700 ${inviteOnly?'team-invites-only':''}`}>
    <h2 className="text-base font-semibold">{tr ? 'Ekip ve hesap yönetimi' : 'Team and account management'}</h2>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{translateMessage(error, lang)}</p>}
    {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300"><Msg text={message}/></p>}
    {allowed ? <>
      <div className="divide-y divide-slate-200 dark:divide-slate-700">{members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="break-all text-sm">{member.username}</span><div className="flex items-center gap-3"><select aria-label={`${member.username} ${tr ? 'rol' : 'role'}`} disabled={busy} value={member.role} onChange={event => void update(member, event.target.value, Boolean(member.active))} className={inputClass}>{['owner', 'admin', 'editor', 'analyst', 'viewer'].map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select><label className="flex shrink-0 items-center gap-2 text-xs"><input disabled={busy} type="checkbox" checked={Boolean(member.active)} onChange={event => void update(member, member.role, event.target.checked)} />{tr ? 'Aktif' : 'Active'}</label></div></div>)}</div>
      <details className="border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">{tr ? 'Ekip üyesi ekle' : 'Add team member'}</summary><form onSubmit={event => void submit(event, false)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><Field name="username" label={tr ? 'Kullanıcı adı' : 'Username'} inputClass={inputClass} /><Field name="password" label={tr ? 'Başlangıç şifresi (en az 12 karakter)' : 'Initial password (at least 12 characters)'} password inputClass={inputClass} /><label className="text-xs">{tr ? 'Rol' : 'Role'}<select name="role" className={`mt-1 ${inputClass}`}>{['viewer', 'editor', 'analyst', 'admin', 'owner'].map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'Üye oluştur' : 'Create member'}</button></form></details>
      {canProvision && <details className="border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">{tr ? 'Yeni müşteri organizasyonu oluştur' : 'Create customer organization'}</summary><form onSubmit={event => void submit(event, true)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><Field name="organizationName" label={tr ? 'Organizasyon adı' : 'Organization name'} inputClass={inputClass} /><Field name="projectName" label={tr ? 'Ürün adı' : 'Product name'} inputClass={inputClass} /><Field name="website" label={tr ? 'Web sitesi' : 'Website'} url inputClass={inputClass} /><Field name="username" label={tr ? 'Yönetici kullanıcı adı' : 'Owner username'} inputClass={inputClass} /><Field name="password" label={tr ? 'Başlangıç şifresi (en az 12 karakter)' : 'Initial password (at least 12 characters)'} password inputClass={inputClass} /><button disabled={busy} className="self-end studio-primary disabled:opacity-50">{tr ? 'Organizasyon oluştur' : 'Create organization'}</button></form><p className="mt-2 text-xs text-slate-500">{tr ? 'Yeni projede önce hesap ve ekip alanı açılır. Marketing araçları proje bağlantıları tamamlandıkça etkinleşir.' : 'New projects start with account and team settings. Marketing tools become available as project connections are configured.'}</p></details>}
    </> : <p className="text-xs text-slate-500">{tr ? 'Ekip yönetimi için organizasyon sahibi veya yönetici yetkisi gerekir.' : 'Team management requires an owner or admin role.'}</p>}
  </section>;
}

function Field({ name, label, inputClass, password, url }: { name: string; label: string; inputClass: string; password?: boolean; url?: boolean }) {
  return <label className="text-xs">{label}<input required name={name} type={password ? 'password' : url ? 'url' : 'text'} minLength={password ? 12 : 1} maxLength={password ? 256 : 160} autoComplete={password ? 'new-password' : 'off'} className={`mt-1 ${inputClass}`} /></label>;
}
