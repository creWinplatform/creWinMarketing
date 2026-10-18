'use client';
import { Suspense, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import { useLang } from '@/lib/lang';
function LoginForm() {
  const { lang } = useLang(),
    tr = lang === 'tr',
    params = useSearchParams();
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [show, setShow] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null),
    passwordRef = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: usernameRef.current?.value.trim() || username.trim(),
            password: passwordRef.current?.value || password,
          }),
          signal: AbortSignal.timeout(20000),
        }),
        data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error || (tr ? 'Giriş başarısız.' : 'Sign in failed.'));
        return;
      }
      const from = params.get('from') || '/',
        destination = new URL(from, window.location.origin);
      window.location.href =
        destination.origin === window.location.origin
          ? destination.pathname + destination.search
          : '/';
    } catch {
      setError(
        tr
          ? 'Sunucuya bağlanılamadı. Tekrar deneyin.'
          : 'Could not connect to the server. Try again.',
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="auth-page auth-designed auth-ryzevo" lang={lang}>
      <aside className="auth-story"><a href="/welcome" aria-label="Ryzevo"><Brand inverse /></a><div className="ryz-auth-story-body"><span className="ryz-kicker">GROW WITH INTENT.</span><h2>{tr ? 'Bir sonraki iyi adım, buradan başlar.' : 'Your next good move starts here.'}</h2><p>{tr ? 'Fikirden içeriğe. Kampanyadan sonuca. Ekibinizle aynı yönde.' : 'From idea to content. From campaign to results. Moving together.'}</p><div className="ryz-auth-path"><span>01 / STRATEJİ</span><ArrowRight size={18} /><span>02 / ÜRETİM</span><ArrowRight size={18} /><span>03 / BÜYÜME</span></div></div><small>© {new Date().getFullYear()} Ryzevo · ryzevo.com</small></aside>
      <div className="auth-entry">
      <a className="auth-mobile-brand" href="/welcome" aria-label="Ryzevo"><Brand /></a>
      <section className="auth-form-surface">
        <p className="studio-eyebrow">
          {tr ? 'ÇALIŞMA ALANINIZ' : 'YOUR WORKSPACE'}
        </p>
        <h1>{tr ? 'Tekrar hoş geldiniz' : 'Welcome back'}</h1>
        <p>
          {tr
            ? 'Projelerinize ve ekibinizin çalışmalarına devam edin.'
            : 'Continue with your projects and your team’s work.'}
        </p>
        {params.get('updated') === '1' && (
          <p className="studio-success" role="status">
            {tr
              ? 'Şifreniz güncellendi. Yeniden giriş yapın.'
              : 'Password updated. Please sign in again.'}
          </p>
        )}
        <form onSubmit={submit}>
          <div className="studio-form-grid">
            <label className="studio-form-full" htmlFor="username">
              {tr ? 'Kullanıcı adı' : 'Username'}
              <input
                id="username"
                name="username"
                required
                maxLength={160}
                ref={usernameRef}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>
            <div className="studio-form-full">
              <label htmlFor="password">{tr ? 'Şifre' : 'Password'}</label>
              <span className="auth-password">
                <input
                  id="password"
                  name="password"
                  required
                  maxLength={256}
                  type={show ? 'text' : 'password'}
                  ref={passwordRef}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="icon-button"
                  title={
                    show
                      ? tr
                        ? 'Şifreyi gizle'
                        : 'Hide password'
                      : tr
                        ? 'Şifreyi göster'
                        : 'Show password'
                  }
                  aria-label={
                    show
                      ? tr
                        ? 'Şifreyi gizle'
                        : 'Hide password'
                      : tr
                        ? 'Şifreyi göster'
                        : 'Show password'
                  }
                  aria-pressed={show}
                  aria-controls="password"
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </div>
          </div>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          <button disabled={loading} className="studio-primary w-full">
            {loading ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <ArrowRight size={16} />
            )}{' '}
            {loading
              ? tr
                ? 'Giriş yapılıyor…'
                : 'Signing in…'
              : tr
                ? 'Giriş yap'
                : 'Sign in'}
          </button>
        </form>
        <div className="auth-divider" />
        <a className="studio-text-button" href="/join">
          {tr
            ? 'Davetle yeni çalışma alanı'
            : 'New workspace with an invitation'}
          <ArrowRight size={14} />
        </a>
        <a className="studio-text-button identity-back" href="/recover">{tr?'Şifremi unuttum':'Forgot password'}<ArrowRight size={14}/></a>
        <a className="studio-text-button identity-back" href="/register">{tr?'Yeni çalışma alanı':'New workspace'}<ArrowRight size={14}/></a>
      </section>
      <p className="auth-footer">
        {tr
          ? 'Organizasyon ve proje bazlı erişim'
          : 'Organization and project scoped access'}
      </p>
      </div>
    </main>
  );
}
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="workspace-loading">
          <span className="studio-loader" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
