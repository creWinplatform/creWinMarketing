'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, KeyRound } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import { projectRequest } from '@/lib/platform/client';
function Join() {
  const params = useSearchParams(),
    [token, setToken] = useState(params.get('token') || '');
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [organizationName, setOrganizationName] = useState((params.get('organizationName') || '').slice(0,160)),
    [projectName, setProjectName] = useState((params.get('projectName') || '').slice(0,160)),
    [website, setWebsite] = useState((params.get('website') || '').slice(0,2048)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false),
    [invite, setInvite] = useState<{
      username: string;
      newOrganization: boolean;
    } | null>(null),
    [loading, setLoading] = useState(Boolean(token));
  useEffect(() => {
    const fragmentToken=new URLSearchParams(window.location.hash.slice(1)).get('token');
    if(fragmentToken){setLoading(true);setToken(fragmentToken);}
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    projectRequest<{ username: string; newOrganization: boolean }>(
      '/api/auth/enroll',
      {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ action: 'inspect', token }),
      },
    )
      .then(setInvite)
      .catch((reason) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await projectRequest('/api/auth/enroll', {
        method: 'POST',
        body: JSON.stringify({
          token,
          password,
          organizationName,
          projectName,
          website,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setComplete(true);
      setPassword('');
      setConfirm('');
      window.history.replaceState({}, '', '/join');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Hesap oluşturulamadı.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page ryz-join">
      <a href="/welcome" className="auth-brand">
        <Brand />
      </a>
      <section className="auth-form-surface">
        <p className="studio-eyebrow">PİLOT ERİŞİMİ</p>
        <h1>
          {complete
            ? 'Hesabınız hazır'
            : token
              ? 'Davetinizi tamamlayın'
              : 'Birlikte başlayalım'}
        </h1>
        {complete ? (
          <>
            <p>
              <strong>{invite?.username}</strong> hesabınızla çalışma alanınıza
              giriş yapabilirsiniz.
            </p>
            <a href="/login" className="studio-primary mt-5">
              Giriş yap
              <ArrowRight size={16} />
            </a>
          </>
        ) : !token ? (
          <>
            <p>
              Pilot çalışma alanları şu anda davetle açılıyor. Platform
              yöneticisinden tek kullanımlık bir davet bağlantısı isteyin.
            </p>
            <a href="/login" className="studio-primary mt-5">
              Mevcut hesabımla giriş yap
              <ArrowRight size={16} />
            </a>
            <a className="studio-text-button mt-5" href="/welcome">
              Ürün sayfasına dön
            </a>
          </>
        ) : loading ? (
          <p role="status">Davet doğrulanıyor…</p>
        ) : !invite ? (
          <p className="studio-error" role="alert">
            {error || 'Davet geçersiz veya süresi dolmuş.'}
          </p>
        ) : (
          <>
            <p>
              Kullanıcı adınız: <strong>{invite.username}</strong>
            </p>
            <form onSubmit={submit}>
              <div className="studio-form-grid">
                {invite.newOrganization && (
                  <>
                    <label className="studio-form-full">
                      Organizasyon adı
                      <input
                        required
                        maxLength={160}
                        value={organizationName}
                        onChange={(event) =>
                          setOrganizationName(event.target.value)
                        }
                      />
                    </label>
                    <label className="studio-form-full">
                      Ürün / proje adı
                      <input
                        required
                        maxLength={160}
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                      />
                    </label>
                    <label className="studio-form-full">
                      Web sitesi
                      <input
                        required
                        type="url"
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        placeholder="https://"
                      />
                    </label>
                  </>
                )}
                <label className="studio-form-full">
                  Yeni şifre
                  <input
                    type="password"
                    required
                    minLength={12}
                    maxLength={256}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="studio-form-full">
                  Şifre tekrar
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
              {error && (
                <p className="studio-error" role="alert">
                  {error}
                </p>
              )}
              <button className="studio-primary w-full mt-6" disabled={busy}>
                <KeyRound size={16} />
                {busy ? 'Oluşturuluyor…' : 'Hesabımı oluştur'}
              </button>
            </form>
          </>
        )}
      </section>
      <p className="auth-footer">Organizasyon ve proje bazlı erişim.</p>
    </main>
  );
}
export default function JoinPage() {
  return (
    <Suspense
      fallback={<main className="workspace-loading">Davet yükleniyor…</main>}
    >
      <Join />
    </Suspense>
  );
}
