import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight, CalendarCheck2, ChartNoAxesCombined, Fingerprint, PenLine, ShieldCheck, Target } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import WorkspaceMap from '@/components/marketing/WorkspaceMap';
import ToolCollapse from '@/components/marketing/ToolCollapse';
import Reveal from '@/components/marketing/Reveal';
import CoachShowcase from '@/components/marketing/CoachShowcase';
import '../landing-coach.css';
import { LangToggle } from '@/lib/lang';
import { requestLang } from '@/lib/i18n/server';
import type { Lang } from '@/lib/i18n/shared';

// Landing: kontrollü pilot. Gerçek müşteri logosu, yorum, büyüme yüzdesi, fiyat veya kullanım sayısı yok;
// ürün ekranları "Örnek proje verileri" etiketiyle gösterilir. CTA'lar mevcut akışlarla sınırlı: keşfet, davetle katıl, giriş yap.
// Metinler TR/EN; terminoloji: docs/RYZEVO-I18N.md

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type L = { tr: string; en: string };
const l = (tr: string, en: string): L => ({ tr, en });

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = await requestLang((await searchParams).lang);
  return {
    title: lang === 'en' ? 'A growth workspace built around your product' : 'Ürününe özel büyüme çalışma alanı',
    description: lang === 'en'
      ? 'Ryzevo brings your AI-assisted content, campaigns, SEO work and team together around one goal.'
      : 'Ryzevo: AI destekli içeriklerini, kampanyalarını, SEO çalışmalarını ve ekibini aynı hedef etrafında buluştur.',
    alternates: { languages: { tr: '/welcome?lang=tr', en: '/welcome?lang=en' } },
  };
}

const STEPS = [
  { Icon: Fingerprint, t: l('Ürününü tanımla', 'Define your product'), p: l('Marka dili, hedef kitle, dönüşüm aşamaları ve ekip rolleri.', 'Brand voice, target audience, conversion stages and team roles.') },
  { Icon: Target, t: l('Hedefini belirle', 'Set your goal'), p: l('Kendi aşamalarını yaz; metrikler bunlara bağlanır.', 'Write your own stages; metrics link to them.') },
  { Icon: PenLine, t: l('İçeriğini hazırla', 'Prepare your content'), p: l('AI stüdyosu fikir ve taslak üretir; kanal bazlı hazırlık.', 'The AI studio drafts ideas and copy, prepared per channel.') },
  { Icon: ShieldCheck, t: l('Onayla ve uygula', 'Approve and act'), p: l('İnceleme, onay ve kontrollü gönderim. Her çıkış bir insan kararı.', 'Review, approval and controlled sending. Every release is a human decision.') },
  { Icon: ChartNoAxesCombined, t: l('Sonuçlarını izle', 'Track your results'), p: l('Tarihli, kaynağı belli ölçümler. Sonuç bir sonraki adımı besler.', 'Dated, sourced measurements. Each result informs the next step.') },
];

const PATHS = [
  { t: l('SaaS', 'SaaS'), s: [l('Deneme', 'Trial'), l('Aktivasyon', 'Activation'), l('Ücretli müşteri', 'Paying customer')] },
  { t: l('Hizmet işletmesi', 'Service business'), s: [l('Talep', 'Lead'), l('Görüşme', 'Meeting'), l('Teklif', 'Proposal'), l('Kazanılan proje', 'Won project')] },
  { t: l('Pazar yeri', 'Marketplace'), s: [l('Kayıt', 'Sign-up'), l('İlk işlem', 'First transaction'), l('Tekrar kullanım', 'Repeat use')] },
];

const PILOT = [
  l('Ürününe özel hedefler ve marka dili', 'Goals and brand voice specific to your product'),
  l('İçerik ve kampanya taslakları', 'Content and campaign drafts'),
  l('İş planı ve tarihli ölçüm kayıtları', 'Work plan and dated measurement records'),
  l('Ekip rolleri ve projeye özel erişim', 'Team roles and project-scoped access'),
];

const FAQ = [
  { q: l('Pazarlama bilgimiz yok; yine de kullanabilir miyiz?', 'We have no marketing expertise. Can we still use it?'),
    a: l('Evet, bunun için tasarlandı. Büyüme koçu sade sorularla başlar, ürününüze özel bir strateji taslağı hazırlar ve her hafta neyi neden yapacağınızı gösterir. Kararları ve onayları ekibiniz verir.', 'Yes, that is who it is built for. The growth coach starts with plain questions, prepares a strategy draft for your product and shows what to do each week and why. Your team makes the decisions and approvals.') },
  { q: l('Kendi ürünüm için kullanabilir miyim?', 'Can I use it for my own product?'),
    a: l('Evet. Ürün profiliniz, hedefleriniz ve ekibiniz kendi çalışma alanınızda yer alır. Müşteriye özel araçlar yalnızca o müşterinin projesinde kalır.', 'Yes. Your product profile, goals and team live in your own workspace. Customer-specific tools stay only in that customer’s project.') },
  { q: l('İçerikler kendiliğinden yayımlanıyor mu?', 'Is content published automatically?'),
    a: l('Hayır. Standart pilot içerikleri ve kampanyaları taslak olarak saklar. İş takvimi otomatik yayın anlamına gelmez.', 'No. The standard pilot keeps content and campaigns as drafts. The work calendar doesn’t mean automatic publishing.') },
  { q: l('Çalışma alanına nasıl katılırım?', 'How do I join a workspace?'),
    a: l('Platform yöneticinizden tek kullanımlık davet bağlantısı isteyin. Mevcut hesabınız varsa giriş ekranından devam edebilirsiniz.', 'Ask your platform administrator for a single-use invitation link. If you already have an account, continue from the sign-in screen.') },
  { q: l('Sonuçları nasıl takip ederim?', 'How do I track results?'),
    a: l('Projenizin hedeflerine bağlı, kaynağı ve tarihi belli ölçümlerle. Bağlanmamış servisler için trafik, gelir veya performans verisi üretilmez.', 'With dated, sourced measurements tied to your project’s goals. No traffic, revenue or performance data is generated for services that aren’t connected.') },
];

function BrandPair({ compact = false }: { compact?: boolean }) {
  return (<><span className="rm-brand-l"><Brand compact={compact} /></span><span className="rm-brand-d"><Brand compact={compact} inverse /></span></>);
}

export default async function WelcomePage({ searchParams }: Props) {
  const lang: Lang = await requestLang((await searchParams).lang);
  const t = (tr: string, en: string) => (lang === 'en' ? en : tr);
  const tx = (value: L) => value[lang];
  const nav = <><a href="#map">{t('Harita', 'Map')}</a><a href="#coach">{t('Koç', 'Coach')}</a><a href="#collapse">{t('Neden tek yer', 'Why one place')}</a><a href="#flow">{t('Akış', 'Flow')}</a><a href="#pilot">Pilot</a></>;
  return (
    <div className="ryz-map" lang={lang}>
      <Reveal />
      <a className="skip-link" href="#ryzevo-main">{t('İçeriğe geç', 'Skip to content')}</a>
      <input type="checkbox" id="rm-menu" className="rm-menu-toggle" hidden />
      <header className="rm-nav">
        <div className="rm-wrap">
          <a href="/welcome" aria-label={t('Ryzevo ana sayfa', 'Ryzevo home')} className="rm-logo"><BrandPair /></a>
          <nav aria-label={t('Ürün navigasyonu', 'Product navigation')}>{nav}</nav>
          <div className="rm-nav-cta"><LangToggle className="rm-btn rm-btn-line rm-lang" /><a className="rm-btn rm-btn-line" href="/login">{t('Giriş yap', 'Sign in')}</a><a className="rm-btn rm-btn-ink" href="/join">{t('Davetle katıl', 'Join by invite')} <ArrowUpRight size={16} /></a></div>
          <div className="rm-nav-mobile"><LangToggle className="rm-btn rm-btn-line rm-lang" /><label className="rm-burger" htmlFor="rm-menu">{t('Menü', 'Menu')}</label></div>
        </div>
      </header>
      <div className="rm-mobile">
        {nav}
        <a className="rm-btn rm-btn-line" href="/login">{t('Giriş yap', 'Sign in')}</a><a className="rm-btn rm-btn-ink" href="/join">{t('Davetle katıl', 'Join by invite')} <ArrowUpRight size={16} /></a>
      </div>

      <main id="ryzevo-main">
        <WorkspaceMap lang={lang} />

        <CoachShowcase lang={lang} />

        <section className="rm-collapse" id="collapse">
          <div className="rm-wrap rm-col-grid">
            <div data-reveal><span className="rm-k">{t('Neden tek yer', 'Why one place')}</span>
              <h2>{t('Bir sürü sekme değil.', 'Not a pile of tabs.')}<br />{t('Ortak bir yön.', 'One shared direction.')}</h2>
              <p>{t('İçerik, kampanya, SEO, görev ve ölçüm farklı araçlarda dağılınca bağlam kaybolur; yapılan işin büyüme hedefine katkısını izlemek zorlaşır. Ryzevo hepsini ürününün hedefleri etrafında düzenler.', 'When content, campaigns, SEO, tasks and measurement live in separate tools, context gets lost and it’s hard to see how the work moves your growth goal. Ryzevo organizes all of it around your product’s goals.')}</p></div>
            <ToolCollapse lang={lang} />
          </div>
        </section>

        <section className="rm-flow" id="flow">
          <div className="rm-wrap">
            <div data-reveal><span className="rm-k">{t('Akış', 'Flow')}</span><h2>{t('Tanımla, hedefle, hazırla, onayla, izle.', 'Define, target, prepare, approve, track.')}</h2><p className="rm-sec-lead">{t('Kime ulaşmak istiyoruz, hangi eylemi bekliyoruz, şimdi ne yapmalıyız ve ne sonuç aldık? Aynı çalışma alanında.', 'Who do we want to reach, what action do we expect, what should we do now, and what did we get? All in the same workspace.')}</p></div>
            <ol className="rm-steps" data-reveal>{STEPS.map(({ Icon, t: title, p }) => <li key={title.tr} className="rm-step"><span className="rm-step-ic" aria-hidden="true"><Icon size={18} /></span><h3>{tx(title)}</h3><p>{tx(p)}</p></li>)}</ol>
            <div className="rm-diff" data-reveal><span className="rm-k">{t('En önemli fark', 'The key difference')}</span><h2>{t('Herkese aynı başarı tablosunu dayatmaz.', 'No one-size-fits-all success dashboard.')}</h2><p className="rm-sec-lead">{t('Büyüme tanımını sen yazarsın. Ryzevo aşamaları, içerikleri ve ölçümleri ona göre düzenler.', 'You define what growth means. Ryzevo organizes stages, content and measurements around it.')}</p></div>
            <div className="rm-fgrid" data-reveal>
              {PATHS.map(p => <div key={p.t.tr} className="rm-fun"><h3>{tx(p.t)}</h3><small>{t('Örnek büyüme yolu', 'Example growth path')}</small><div className="rm-path">{p.s.map((x, i) => <span key={x.tr}>{tx(x)}<i>{i === p.s.length - 1 ? t('hedef', 'goal') : i + 1}</i></span>)}</div></div>)}
            </div>
          </div>
        </section>

        <section className="rm-pilot-sec" id="pilot">
          <div className="rm-wrap">
            <div className="rm-pilot" data-reveal>
              <div><span className="rm-k">{t('Kontrollü pilot', 'Controlled pilot')}</span><h2>{t('Küçük başla. Bilinçli büyü.', 'Start small. Grow with intent.')}</h2><p>{t('Ryzevo şu anda davetle açılan çalışma alanlarıyla ilerliyor. Standart pilotta otomatik yayın ve toplu gönderim kapalıdır; AI kullanımı sağlayıcı yapılandırması gerektirir.', 'Ryzevo currently runs with invite-only workspaces. In the standard pilot, automatic publishing and bulk sending are off; AI features require a configured AI provider.')}</p><div className="rm-ctas"><a className="rm-btn rm-btn-ink" href="/join">{t('Davetle katıl', 'Join by invite')} <ArrowUpRight size={16} /></a><a className="rm-btn rm-btn-line" href="/login">{t('Giriş yap', 'Sign in')}</a></div></div>
              <div><ul>{PILOT.map(item => <li key={item.tr}><CalendarCheck2 size={16} aria-hidden="true" />{tx(item)}</li>)}</ul><p className="rm-bound">{t('Müşteriye özel araçlar o müşterinin hesabında kalır; başka işletmeler kendi çalışma alanlarını kullanır.', 'Customer-specific tools stay in that customer’s account; other businesses use their own workspaces.')}</p></div>
            </div>
          </div>
        </section>

        <section className="rm-faq">
          <div className="rm-wrap rm-faq-wrap" data-reveal>
            <span className="rm-k">{t('Net cevaplar', 'Straight answers')}</span><h2>{t('Başlamadan önce.', 'Before you start.')}</h2>
            <div className="rm-faq-list">{FAQ.map((f, i) => <details key={f.q.tr} open={i === 0}><summary>{tx(f.q)}</summary><p>{tx(f.a)}</p></details>)}</div>
          </div>
        </section>
      </main>

      <footer className="rm-footer">
        <div className="rm-wrap">
          <div className="rm-foot"><div><BrandPair /><div className="rm-tag" lang="en">Grow with intent.</div></div><nav aria-label={t('Alt bağlantılar', 'Footer links')}><a href="/login">{t('Giriş yap', 'Sign in')}</a><a href="/join">{t('Davetle katıl', 'Join by invite')}</a><a href="/login">{t('Çalışma alanına dön', 'Back to your workspace')} <ArrowRight size={14} /></a></nav></div>
          <div className="rm-copy"><span>© {new Date().getFullYear()} Ryzevo · ryzevo.com</span><span>{t('Projene özel. Ekibinle birlikte.', 'Built for your project. Together with your team.')}</span></div>
        </div>
      </footer>
    </div>
  );
}
