import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import { LangToggle } from '@/lib/lang';
import type { Lang } from '@/lib/i18n/shared';
import { privacyReady, salesTermsReady } from '@/lib/platform/sales-terms';
import '@/app/doc-page.css';

// Landing'in (.ryz-map) kabuğunda uzun metin sayfaları: kullanım rehberi ve satış sözleşmesi.
// Satış sözleşmesi ve aydınlatma metni bağlantıları, metinler taslakken alt bilgide gösterilmez.
export type DocSection = { id: string; title: string };

function BrandPair() {
  return (<><span className="rm-brand-l"><Brand /></span><span className="rm-brand-d"><Brand inverse /></span></>);
}

export default function DocShell({ lang, kicker, title, lead, meta, toc, notice, children }: {
  lang: Lang; kicker: string; title: string; lead?: ReactNode; meta?: ReactNode; toc: DocSection[]; notice?: ReactNode; children: ReactNode;
}) {
  const t = (tr: string, en: string) => (lang === 'en' ? en : tr);
  return (
    <div className="ryz-map rd-page" lang={lang}>
      <a className="skip-link" href="#ryzevo-main">{t('İçeriğe geç', 'Skip to content')}</a>
      <header className="rm-nav">
        <div className="rm-wrap">
          <a href="/welcome" aria-label={t('Ryzevo ana sayfa', 'Ryzevo home')} className="rm-logo"><BrandPair /></a>
          <div className="rd-nav-cta"><LangToggle className="rm-btn rm-btn-line rm-lang" /><a className="rm-btn rm-btn-line rd-nav-login" href="/login">{t('Giriş yap', 'Sign in')}</a></div>
        </div>
      </header>
      <main id="ryzevo-main" className="rm-wrap rd-main">
        <header className="rd-head">
          <span className="rm-k">{kicker}</span>
          <h1>{title}</h1>
          {lead && <p className="rd-lead">{lead}</p>}
          {meta && <p className="rd-meta">{meta}</p>}
          {notice}
        </header>
        <div className="rd-layout">
          <nav className="rd-toc" aria-label={t('Bu sayfada', 'On this page')}>
            <span>{t('Bu sayfada', 'On this page')}</span>
            <ol>{toc.map(item => <li key={item.id}><a href={`#${item.id}`}>{item.title}</a></li>)}</ol>
          </nav>
          <article className="rd-body">{children}</article>
        </div>
      </main>
      <footer className="rm-footer">
        <div className="rm-wrap">
          <div className="rm-foot"><div><BrandPair /></div><nav aria-label={t('Alt bağlantılar', 'Footer links')}>
            <a href="/welcome">{t('Ürünü keşfet', 'Explore the product')}</a>
            <a href="/guide">{t('Kullanım rehberi', 'User guide')}</a>
            {salesTermsReady() && <a href="/legal/sales">{t('Satış sözleşmesi', 'Terms of sale')}</a>}
            {privacyReady() && <a href="/legal/privacy">{t('Aydınlatma metni', 'Privacy notice')}</a>}
            <a href="/join">{t('Davetle katıl', 'Join by invite')} <ArrowUpRight size={14} /></a>
          </nav></div>
          <div className="rm-copy"><span>© {new Date().getFullYear()} Ryzevo · ryzevo.com</span></div>
        </div>
      </footer>
    </div>
  );
}
