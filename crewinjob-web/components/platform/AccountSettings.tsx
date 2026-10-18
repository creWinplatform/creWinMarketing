'use client';
import { useState, type FormEvent } from 'react';
import { UserPlus, Copy, ShieldCheck, KeyRound } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import AccountEmail from './AccountEmail';
export default function AccountSettings({
  workspace,
  lang,
}: {
  workspace: WorkspaceContext;
  lang: Locale;
}) {
  const tr = lang === 'tr',
    [username, setUsername] = useState(''),
    [role, setRole] = useState('editor'),
    [newOrganization, setNewOrganization] = useState(false),
    [link, setLink] = useState(''),
    [expiresAt, setExpiresAt] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [currentPassword, setCurrentPassword] = useState(''),
    [nextPassword, setNextPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setLink('');
    try {
      const data = await projectRequest<{ token: string; expiresAt: string }>(
        '/api/platform/account',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'invite',
            username,
            role,
            newOrganization,
          }),
        },
      );
      setLink(
        `${window.location.origin}/join#token=${encodeURIComponent(data.token)}`,
      );
      setExpiresAt(data.expiresAt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-band">
      <div className="studio-section-title">
        <h2 className="flex items-center gap-2">
          <ShieldCheck size={17} />
          {tr ? 'Hesap & erişim' : 'Account & access'}
        </h2>
      </div>
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="studio-success" role="status">
          {notice}
        </p>
      )}
      {workspace.permissions?.includes('members.manage') && (
        <form onSubmit={invite} className="studio-editor">
          <h3 className="text-sm font-semibold">
            {tr ? 'Ekip daveti' : 'Team invitation'}
          </h3>
          <div className="studio-form-grid">
            <label>
              {tr ? 'Yeni kullanıcı adı' : 'New username'}
              <input
                required
                minLength={3}
                maxLength={160}
                pattern="[a-zA-Z0-9@._+\-]+"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {tr ? 'Rol' : 'Role'}
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="editor">{tr ? 'Editör' : 'Editor'}</option>
                <option value="analyst">{tr ? 'Analist' : 'Analyst'}</option>
                <option value="viewer">
                  {tr ? 'Görüntüleyici' : 'Viewer'}
                </option>
                <option value="admin">{tr ? 'Yönetici' : 'Admin'}</option>
              </select>
            </label>
          </div>
          {workspace.accessMode === 'legacy_single_account' && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={newOrganization}
                onChange={(event) => setNewOrganization(event.target.checked)}
              />
              {tr
                ? 'Bağımsız müşteri çalışma alanı daveti'
                : 'Invitation to an independent customer workspace'}
            </label>
          )}
          <div className="studio-form-actions">
            <button className="studio-primary" disabled={busy}>
              <UserPlus size={16} />
              {busy
                ? tr
                  ? 'Hazırlanıyor…'
                  : 'Preparing…'
                : tr
                  ? 'Davet bağlantısı oluştur'
                  : 'Create invitation link'}
            </button>
          </div>
          {link && (
            <div className="mt-4 space-y-2">
              <label className="block text-xs">
                {tr ? 'Davet bağlantısı' : 'Invitation link'}
                <div className="studio-search mt-2 max-w-none">
                  <input readOnly value={link} />
                  <button
                    type="button"
                    className="icon-button"
                    title={
                      tr ? 'Davet bağlantısını kopyala' : 'Copy invitation link'
                    }
                    aria-label={
                      tr ? 'Davet bağlantısını kopyala' : 'Copy invitation link'
                    }
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setNotice(
                          tr
                            ? 'Davet bağlantısı kopyalandı.'
                            : 'Invitation copied.',
                        );
                      } catch {
                        setError(
                          tr
                            ? 'Bağlantıyı alandan seçip kopyalayın.'
                            : 'Select and copy the link from the field.',
                        );
                      }
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </label>
              <p className="studio-note">
                {tr ? 'Son kullanım' : 'Expires'}:{' '}
                {new Date(expiresAt).toLocaleString(tr ? 'tr-TR' : 'en-GB')} ·{' '}
                {tr
                  ? 'Tek kullanımlık. E-posta otomatik gönderilmez.'
                  : 'Single-use. No email is sent automatically.'}
              </p>
            </div>
          )}
        </form>
      )}
      {workspace.accessMode === 'platform_account' && <AccountEmail tr={tr}/>}
      {workspace.accessMode === 'platform_account' && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            if (nextPassword !== confirm) {
              setError(
                tr
                  ? 'Yeni şifreler eşleşmiyor.'
                  : 'New passwords do not match.',
              );
              return;
            }
            setBusy(true);
            try {
              await projectRequest('/api/platform/account', {
                method: 'POST',
                body: JSON.stringify({
                  action: 'password',
                  currentPassword,
                  nextPassword,
                }),
              });
              window.location.href = '/login?updated=1';
            } catch (reason) {
              setError(
                reason instanceof Error ? reason.message : 'Request failed.',
              );
            } finally {
              setBusy(false);
            }
          }}
          className="studio-editor"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={17} />
            {tr ? 'Şifreyi değiştir' : 'Change password'}
          </h3>
          <div className="studio-form-grid">
            <label>
              {tr ? 'Mevcut şifre' : 'Current password'}
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label>
              {tr ? 'Yeni şifre' : 'New password'}
              <input
                type="password"
                required
                minLength={12}
                maxLength={256}
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              {tr ? 'Yeni şifre tekrar' : 'Repeat new password'}
              <input
                type="password"
                required
                minLength={12}
                maxLength={256}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>
          <p className="studio-note">
            {tr
              ? 'En az 12 karakter. Güncelleme, diğer oturumları da kapatır.'
              : 'At least 12 characters. Updating signs out other sessions too.'}
          </p>
          <div className="studio-form-actions">
            <button className="studio-primary" disabled={busy}>
              {busy
                ? tr
                  ? 'Güncelleniyor…'
                  : 'Updating…'
                : tr
                  ? 'Şifreyi güncelle'
                  : 'Update password'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
