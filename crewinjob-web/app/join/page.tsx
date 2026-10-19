'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, KeyRound } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import { projectRequest } from '@/lib/platform/client';
import { LangToggle, useLang, useT } from '@/lib/lang';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
function Join() {
  const { lang } = useLang(),
    t = useT(),
    tr = lang === 'tr';
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
        if (reason.name !== 'AbortError') setError(translateMessage(reason.message, lang));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError(t('Şifreler eşleşmiyor.', 'Passwords do not match.'));
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
        (reason instanceof Error && translateMessage(reason.message, lang)) || t('Hesap oluşturulamadı.', 'Could not create the account.'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page ryz-join relative" lang={lang}>
      <LangToggle className="absolute right-4 top-4 z-10 inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border border-[#cfd7c6] bg-white px-3 text-[11px] font-bold tracking-[.04em] text-[#3f5a28] hover:bg-[#f1f5ea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#789f17]" />
      <a href="/welcome" className="auth-brand">
        <Brand />
      </a>
      <section className="auth-form-surface">
        <p className="studio-eyebrow">{t('PİLOT ERİŞİMİ', 'PILOT ACCESS')}</p>
        <h1>
          {complete
            ? t('Hesabınız hazır', 'Your account is ready')
            : token
              ? t('Davetinizi tamamlayın', 'Complete your invitation')
              : t('Birlikte başlayalım', 'Let’s get started')}
        </h1>
        {complete ? (
          <>
            <p>
              {tr ? (
                <>
                  <strong>{invite?.username}</strong> hesabınızla çalışma alanınıza
                  giriş yapabilirsiniz.
                </>
              ) : (
                <>
                  You can now sign in to your workspace as{' '}
                  <strong>{invite?.username}</strong>.
                </>
              )}
            </p>
            <a href="/login" className="studio-primary mt-5">
              {t('Giriş yap', 'Sign in')}
              <ArrowRight size={16} />
            </a>
          </>
        ) : !token ? (
          <>
            <p>
              {t(
                'Pilot çalışma alanları şu anda davetle açılıyor. Platform yöneticisinden tek kullanımlık bir davet bağlantısı isteyin.',
                'Pilot workspaces are currently opened by invitation only. Ask the platform administrator for a single-use invitation link.',
              )}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href="/login" className="studio-primary">
                {t('Mevcut hesabımla giriş yap', 'Sign in with my existing account')}
                <ArrowRight size={16} />
              </a>
              <a className="studio-text-button" href="/welcome">
                {t('Ürün sayfasına dön', 'Back to the product page')}
              </a>
            </div>
          </>
        ) : loading ? (
          <p role="status">{t('Davet doğrulanıyor…', 'Verifying your invitation…')}</p>
        ) : !invite ? (
          <p className="studio-error" role="alert">
            {error || t('Davet geçersiz veya süresi dolmuş.', 'The invitation is invalid or has expired.')}
          </p>
        ) : (
          <>
            <p>
              {t('Kullanıcı adınız', 'Your username')}: <strong>{invite.username}</strong>
            </p>
            <form onSubmit={submit}>
              <div className="studio-form-grid">
                {invite.newOrganization && (
                  <>
                    <label className="studio-form-full">
                      {t('Organizasyon adı', 'Organization name')}
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
                      {t('Ürün / proje adı', 'Product / project name')}
                      <input
                        required
                        maxLength={160}
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                      />
                    </label>
                    <label className="studio-form-full">
                      {t('Web sitesi', 'Website')}
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
                  {t('Yeni şifre', 'New password')}
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
                  {t('Şifre tekrar', 'Repeat password')}
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
                  <Msg text={error} />
                </p>
              )}
              <button className="studio-primary w-full mt-6" disabled={busy}>
                <KeyRound size={16} />
                {busy ? t('Oluşturuluyor…', 'Creating…') : t('Hesabımı oluştur', 'Create my account')}
              </button>
            </form>
          </>
        )}
      </section>
      <p className="auth-footer">{t('Organizasyon ve proje bazlı erişim.', 'Organization- and project-scoped access.')}</p>
    </main>
  );
}
function JoinFallback() {
  const t = useT();
  return <main className="workspace-loading">{t('Davet yükleniyor…', 'Loading invitation…')}</main>;
}
export default function JoinPage() {
  return (
    <Suspense fallback={<JoinFallback />}>
      <Join />
    </Suspense>
  );
}
