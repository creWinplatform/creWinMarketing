'use client';
import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams }               from 'next/navigation';
import { useLang }                       from '@/lib/lang';
import Image                             from 'next/image';

function LoginForm() {
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const from         = searchParams.get('from') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError(lang === 'tr' ? 'Kullanıcı adı ve şifre gerekli' : 'Username and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || (lang === 'tr' ? 'Giriş başarısız' : 'Login failed'));
        return;
      }
      window.location.href = from;
    } catch {
      setError(lang === 'tr' ? 'Sunucuya bağlanılamadı' : 'Could not connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo & başlık */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-5">
            <Image
              src="/crewin-logo.svg"
              alt="Crewin Logo"
              width={160}
              height={44}
              className="brightness-0 invert"
              priority
            />
          </div>
          <p className="text-slate-400 text-sm">{lang === 'tr' ? 'Marketing Agent — Yönetim Paneli' : 'Marketing Agent — Admin Panel'}</p>
        </div>

        {/* Kart */}
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-slate-100 mb-6 text-center">{lang === 'tr' ? 'Giriş Yap' : 'Sign In'}</h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Kullanıcı adı */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                {lang === 'tr' ? 'Kullanıcı Adı' : 'Username'}
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                placeholder={lang === 'tr' ? 'kullanıcı adı' : 'username'}
                className="bg-slate-700/60 border border-slate-600 text-slate-100 placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/60 focus:border-ocean/60 transition-colors"
              />
            </div>

            {/* Şifre */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                {lang === 'tr' ? 'Şifre' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-slate-700/60 border border-slate-600 text-slate-100 placeholder:text-slate-500 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/60 focus:border-ocean/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors text-lg leading-none"
                  tabIndex={-1}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* Hata mesajı */}
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Buton */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {lang === 'tr' ? 'Giriş yapılıyor...' : 'Signing in...'}
                </>
              ) : (
                `🔐 ${lang === 'tr' ? 'Giriş Yap' : 'Sign In'}`
              )}
            </button>
          </form>
        </div>

        {/* Alt bilgi */}
        <p className="text-center text-slate-600 text-xs mt-6">
          crewinjob.com · {lang === 'tr' ? 'Dahili Pazarlama Aracı' : 'Internal Marketing Tool'}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-ocean border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
