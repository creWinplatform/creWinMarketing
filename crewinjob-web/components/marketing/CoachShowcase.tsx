import { CalendarRange, ClipboardCheck, FileSearch, ListChecks, MessagesSquare, Sparkles } from 'lucide-react';
import type { Lang } from '@/lib/i18n/shared';

// Landing: büyüme koçu. Pazarlama uzmanı olmayan ekipler için asıl fark bu katman.
// Ekranlar gerçek arayüzün adlarını kullanır (components/platform/GrowthCoach.tsx) ve "Örnek" etiketlidir;
// içerik örnek proje verisidir. Uydurma rakam, sonuç veya otomatik yayın iddiası yok.

type L = { tr: string; en: string };
const l = (tr: string, en: string): L => ({ tr, en });

const QUESTIONS: Array<{ q: L; a: L }> = [
  { q: l('1. Ne satıyorsunuz?', '1. What do you sell?'), a: l('Küçük ekipler için proje takip uygulaması', 'A project tracking app for small teams') },
  { q: l('2. Kim satın alıyor?', '2. Who buys it?'), a: l('Ajans ve stüdyo kurucuları', 'Agency and studio founders') },
  { q: l('7. Haftada ne kadar zamanınız var?', '7. How much time do you have per week?'), a: l('2–4 saat', '2–4 hours') },
];

const PLAN: Array<{ w: string; t: L }> = [
  { w: '1', t: l('Ürün sayfası için site denetimi', 'Site audit for the product page') },
  { w: '2', t: l('İlk iki LinkedIn gönderisi', 'First two LinkedIn posts') },
  { w: '3', t: l('Hoş geldin e-postası taslağı', 'Welcome email draft') },
];

const ACTIONS: Array<{ pre?: boolean; t: L; why: L; time: L }> = [
  { pre: true, t: l('Ürün sayfası için site denetimi yap', 'Run a site audit on the product page'), why: l('Arama motorlarının sayfanı anlamasını engelleyen temel sorunları görmek için.', 'To see the basic issues that stop search engines from understanding your page.'), time: l('~30 dk', '~30 min') },
  { t: l('İlk LinkedIn gönderisini taslak olarak hazırla', 'Draft your first LinkedIn post'), why: l('Hedef müşterin orada; düzenli görünmek güven kurar.', 'Your target customers are there; showing up regularly builds trust.'), time: l('~45 dk', '~45 min') },
];

const NEXT: Array<{ Icon: typeof CalendarRange; t: L; p: L }> = [
  { Icon: CalendarRange, t: l('Aylık içerik planı', 'Monthly content plan'), p: l('Onaylı stratejiden kanal kanal tema ve gönderi fikirleri. Her biri tek tıkla taslağa ya da takvime.', 'Themes and post ideas per channel from the approved strategy. Each one becomes a draft or a calendar task in one click.') },
  { Icon: FileSearch, t: l('SEO konuları ve brifleri', 'SEO topics and briefs'), p: l('Ürününden konu grupları ve içerik brifleri. Search Console bağlıysa gerçek sorgular; arama hacmi veya sıralama uydurulmaz.', 'Topic groups and content briefs from your product. Real queries when Search Console is connected; search volume or rankings are never made up.') },
  { Icon: MessagesSquare, t: l('Haftalık özet', 'Weekly review'), p: l('Yalnız gerçek kayıtlardan: ne değişti, ne işe yarıyor, plan nasıl güncellenmeli. Veri yoksa bunu açıkça söyler.', 'Built only from real records: what changed, what seems to work, how the plan could change. With no data, it says so.') },
];

export default function CoachShowcase({ lang = 'tr' }: { lang?: Lang }) {
  const t = (tr: string, en: string) => (lang === 'en' ? en : tr);
  const tx = (v: L) => v[lang];
  const sample = t('Örnek', 'Sample');
  return (
    <section className="rm-coach" id="coach" aria-labelledby="rm-coach-title">
      <div className="rm-wrap">
        <div className="rm-coach-head" data-reveal>
          <span className="rm-k">{t('Büyüme koçu', 'Growth coach')}</span>
          <h2 id="rm-coach-title">{t('Pazarlama uzmanın yoksa da nereden başlayacağını bilirsin.', 'No marketing expert? You still know where to start.')}</h2>
          <p className="rm-sec-lead">{t('Sade sorularla başlar. Cevaplarından ürününe özel bir strateji taslağı hazırlanır; sen düzenleyip onaylarsın. Sonra her hafta neyi, neden ve nasıl yapacağını gösterir.', 'It starts with plain questions. Your answers become a strategy draft for your product that you edit and approve. Then every week it shows what to do, why and how.')}</p>
        </div>

        <ol className="rm-coach-steps" data-reveal>
          <li className="rm-coach-step">
            <div className="rm-coach-cap"><span className="rm-coach-n" aria-hidden="true"><ListChecks size={16} /></span><div><h3>{t('Teşhis', 'Diagnosis')}</h3><p>{t('Ne sattığın, kime sattığın, ekibinin zamanı ve becerileri. Pazarlama terimi bilmen gerekmez.', 'What you sell, who buys it, your team’s time and skills. No marketing jargon needed.')}</p></div></div>
            <div className="rm-screen rm-coach-screen" aria-hidden="true">
              <div className="rm-scr-top"><span>{t('Büyüme koçu', 'Growth coach')}</span><span>{sample}</span></div>
              <h4>{t('Büyüme teşhisi', 'Growth diagnosis')}</h4>
              {QUESTIONS.map(item => <div className="rm-f" key={item.q.tr}><label>{tx(item.q)}</label><div>{tx(item.a)}</div></div>)}
              <div className="rm-tool"><span className="pri">{t('Taslağı hazırla', 'Prepare the draft')}</span></div>
            </div>
          </li>

          <li className="rm-coach-step">
            <div className="rm-coach-cap"><span className="rm-coach-n" aria-hidden="true"><ClipboardCheck size={16} /></span><div><h3>{t('Strateji briefi', 'Strategy brief')}</h3><p>{t('Hedef müşteri, konumlandırma, gerekçesiyle öncelikli kanallar ve 30 günlük plan. Her alanı düzenlersin; onaylamadan hiçbir şey değişmez.', 'Target customer, positioning, priority channels with reasons and a 30-day plan. You edit every field; nothing changes until you approve.')}</p></div></div>
            <div className="rm-screen rm-coach-screen" aria-hidden="true">
              <div className="rm-scr-top"><span>{t('Strateji briefi', 'Strategy brief')}</span><span className="rm-coach-pending">{t('Onay bekliyor', 'Awaiting approval')}</span></div>
              <div className="rm-f"><label>{t('Hedef müşteri', 'Target customer')}</label><div>{t('5–20 kişilik ajanslarda projeleri yöneten kurucular', 'Founders running projects at 5–20 person agencies')}</div></div>
              <div className="rm-f"><label>{t('Öncelikli kanallar', 'Priority channels')}</label><div className="rm-chips"><span className="on">{t('LinkedIn şirket sayfası', 'LinkedIn company page')}</span><span className="on">{t('E-posta', 'Email')}</span><span>SEO</span></div></div>
              <div className="rm-f"><label>{t('30 günlük plan', '30-day plan')}</label></div>
              <div className="rm-rows">{PLAN.map(p => <div className="rm-row" key={p.w}><div className="rm-d"><b>{p.w}</b>{t('hafta', 'week')}</div><div><b>{tx(p.t)}</b></div><span /></div>)}</div>
              <div className="rm-tool"><span>{t('Düzenle', 'Edit')}</span><span className="pri">{t('Onayla', 'Approve')}</span></div>
            </div>
          </li>

          <li className="rm-coach-step">
            <div className="rm-coach-cap"><span className="rm-coach-n" aria-hidden="true"><Sparkles size={16} /></span><div><h3>{t('Bu hafta', 'This week')}</h3><p>{t('Her hafta en fazla üç iş: neden önemli, nasıl yapılır, yaklaşık ne kadar sürer. Tek tıkla ilgili araca ya da takvime.', 'At most three tasks a week: why it matters, how to do it and roughly how long it takes. One click to the right tool or the calendar.')}</p></div></div>
            <div className="rm-screen rm-coach-screen" aria-hidden="true">
              <div className="rm-scr-top"><span>{t('Bu hafta', 'This week')}</span><span>{sample}</span></div>
              {ACTIONS.map(a => (
                <div className="rm-coach-action" key={a.t.tr}>
                  {a.pre && <span className="rm-coach-badge">{t('Ön koşul', 'Prerequisite')}</span>}
                  <b>{tx(a.t)}</b>
                  <p><em>{t('Neden: ', 'Why: ')}</em>{tx(a.why)}</p>
                  <div className="rm-coach-meta"><span>{t('Nasıl yapılır', 'How to do it')}</span><span>{tx(a.time)}</span></div>
                  <div className="rm-tool"><span>{t('Takvime ekle', 'Add to Calendar')}</span><span className="pri">{t('Tamamlandı', 'Done')}</span></div>
                </div>
              ))}
            </div>
          </li>
        </ol>

        <div className="rm-coach-next" data-reveal>
          <span className="rm-k">{t('Sonra', 'Then')}</span>
          <ul>{NEXT.map(({ Icon, t: title, p }) => <li key={title.tr}><span className="rm-coach-n" aria-hidden="true"><Icon size={16} /></span><div><h3>{tx(title)}</h3><p>{tx(p)}</p></div></li>)}</ul>
          <p className="rm-coach-rule">{t('Yapay zekâ önerir, ekibin karar verir. Hiçbir şey kendiliğinden yayımlanmaz veya gönderilmez; veri yoksa tahmin ya da rakam üretilmez.', 'AI suggests, your team decides. Nothing is published or sent on its own; with no data, no estimates or numbers are made up.')}</p>
        </div>
      </div>
    </section>
  );
}
