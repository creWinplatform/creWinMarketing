import type { Metadata } from 'next';
import { Fragment } from 'react';
import DocShell from '@/components/marketing/DocShell';
import { requestLang } from '@/lib/i18n/server';
import type { Lang } from '@/lib/i18n/shared';

// Pilot ekipler için kullanım rehberi: pazarlama uzmanı olmayan bir ekip Ryzevo'yu nereden başlayıp nasıl kullanır.
// Ekran adları uygulamadaki etiketlerle aynı tutulur (docs/RYZEVO-I18N.md). Sonuç, rakam veya müşteri iddiası yok;
// süreler tahmindir ve öyle yazılır.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type L = { tr: string; en: string };
const l = (tr: string, en: string): L => ({ tr, en });

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = await requestLang((await searchParams).lang);
  return {
    title: lang === 'en' ? 'User guide: growing without a marketing specialist' : 'Kullanım rehberi: pazarlama uzmanı olmadan büyümek',
    description: lang === 'en'
      ? 'How a team with no SEO, social media or digital marketing background uses Ryzevo: the first day, the weekly rhythm and the end of the month.'
      : 'SEO, sosyal medya veya dijital pazarlama deneyimi olmayan bir ekip Ryzevo’yu nasıl kullanır: ilk gün, haftalık ritim ve ay sonu.',
    alternates: { languages: { tr: '/guide?lang=tr', en: '/guide?lang=en' } },
  };
}

const RULES = [
  { t: l('Öneri Ryzevo’dan, karar sizden.', 'Ryzevo suggests, you decide.'),
    p: l('AI veya kurallı başlangıç şablonları taslak hazırlar. Onaylamadığınız hiçbir şey plana girmez; Ryzevo hiçbir içeriği kendiliğinden yayınlamaz ya da göndermez.', 'AI or rule-based starter templates prepare drafts. Nothing enters the plan until you approve it, and Ryzevo never publishes or sends content on its own.') },
  { t: l('Rakam uydurmaz.', 'No made-up numbers.'),
    p: l('Bağlamadığınız bir kaynak için trafik, gelir veya etkileşim gösterilmez. “Veri yok”, sıfır demek değildir.', 'No traffic, revenue or engagement is shown for a source you haven’t connected. “No data” does not mean zero.') },
  { t: l('Küçük adımlarla ilerler.', 'Small steps.'),
    p: l('Her hafta en fazla üç eylem görürsünüz. Her birinde neden önemli olduğu, nasıl yapılacağı ve tahmini süresi yazar. Plan, ayırdığınız zamana göre kısalır.', 'Each week you see at most three actions, each with why it matters, how to do it and an estimated time. The plan shrinks to fit the time you have.') },
];

const FIRST_DAY = [
  { t: l('Hesabınızı açın', 'Activate your account'), w: l('Davet bağlantısı', 'Invitation link'),
    p: l('Size gelen davet bağlantısını açın ve kendi şifrenizi belirleyin. Bağlantı tek kullanımlıktır ve süresi dolabilir; dolduysa yöneticinizden yenisini isteyin.', 'Open the invitation link you received and choose your own password. The link works once and can expire; if it has, ask your administrator for a new one.') },
  { t: l('Ürününüzü tanıtın', 'Describe your product'), w: l('Proje ayarları', 'Project settings'),
    p: l('Ne sattığınızı, web sitenizi, kime sattığınızı ve nasıl konuştuğunuzu yazın. Bilmediğiniz alanları boş bırakın; sonra doldurabilirsiniz. Ryzevo’nun hazırladığı her taslak bu bilgileri kullanır.', 'Write what you sell, your website, who buys it and how you talk. Leave anything you don’t know blank and fill it in later. Every draft Ryzevo prepares uses this information.') },
  { t: l('Büyüme teşhisini yapın', 'Run the growth diagnosis'), w: l('Genel bakış → Büyüme koçu → Teşhise başla', 'Overview → Growth coach → Start the diagnosis'),
    p: l('Önce ana hedefinizi seçin: nitelikli talep, sosyal medyada erişim, müşteriyi elde tutma, arama (SEO) veya mobil uygulama. Sonra on bir kısa soruyu yanıtlayın: ne satıyorsunuz, kim alıyor, satış nerede oluyor, ekibin haftalık zamanı, reklam bütçesi ve becerileri, en büyük engel. Doğru ya da yanlış cevap yoktur.', 'First pick your main goal: qualified leads, social media reach, customer retention, search (SEO) or a mobile app. Then answer eleven short questions: what you sell, who buys it, where the sale happens, your team’s weekly time, ad budget and skills, and the biggest obstacle. There are no right or wrong answers.') },
  { t: l('Strateji briefini inceleyin', 'Review the strategy brief'), w: l('Genel bakış → Taslağı incele', 'Overview → Review draft'),
    p: l('Koç bir taslak hazırlar: ideal müşteri, müşterinin sorunları (doğrulanacak varsayımlar olarak), konumlandırma, 2–3 öncelikli kanal ve 30 günlük plan. Uygunsa kanallardan biri WhatsApp ya da ücretli reklam olabilir; reklam yalnız bütçeniz varsa önerilir. AI yapılandırılmışsa AI önerisi, değilse yanıtlarınızdan kural tabanlı başlangıç gelir. Her alanı düzenleyebilirsiniz.', 'The coach drafts a brief: ideal customer, the customer’s problems (as assumptions to check), positioning, 2–3 priority channels and a 30-day plan. Where it fits, one channel can be WhatsApp or paid ads; ads are only suggested if you have a budget. With AI configured it is an AI suggestion; otherwise it is a rule-based starter from your answers. You can edit every field.') },
  { t: l('Briefi onaylayın', 'Approve the brief'), w: l('Sahip veya yönetici', 'Owner or admin'),
    p: l('Briefi proje sahibi veya yönetici onaylar; editörler taslağı kaydedebilir. Onaydan sonra “Bu hafta” listesi ve Büyüme pusulası bu briefe göre açılır.', 'The project owner or an admin approves the brief; editors can save the draft. After approval, the “This week” list and the Growth compass follow this brief.') },
];

const WEEK = [
  { t: l('Haftanın başında: Bu hafta', 'At the start of the week: This week'), w: l('Genel bakış', 'Overview'),
    p: l('En fazla üç eylem görürsünüz. Kartta neden, nasıl ve tahmini süre yazar; düğme sizi doğru araca götürür. İçerik stüdyosu ve kampanya bağlantıları brief ve kanalla ön doldurulmuş açılır; siz kaydetmeden hiçbir şey oluşmaz.', 'You see up to three actions. Each card shows why, how and an estimated time, and its button takes you to the right tool. Content studio and campaign links open pre-filled with the brief and channel; nothing is created until you save.') },
  { t: l('Eylemi kapatın', 'Close the action'), w: l('Eylem kartı', 'Action card'),
    p: l('Bitince “Tamamlandı” deyin. Bu hafta yetişmeyecekse “Bu hafta atla”: eylem gelecek hafta geri gelir. Bir tarih vermek için takvime ekleyin ya da bir ekip arkadaşınıza atayın; atananlar “Bana atananlar” bölümünde görünür.', 'Mark it done when finished. If it won’t fit this week, choose “Skip this week” and it comes back next week. Add it to the Calendar to give it a date, or assign it to a teammate; assigned work appears under “Assigned to me”.') },
  { t: l('Ölçün', 'Measure'), w: l('Analitik veya Proje ayarları → Bağlantılar', 'Analytics or Project settings → Connections'),
    p: l('Haftada bir, hedefinizin aşamalarına sayı girin ya da Google Analytics ve Search Console’u bağlayın. Ölçüm girilmeyen hafta “ölçüm yok” olarak görünür.', 'Once a week, enter numbers for your goal’s stages or connect Google Analytics and Search Console. A week with no measurement shows as “no measurement”.') },
  { t: l('Haftanın sonunda: Haftalık özet', 'At the end of the week: Weekly review'), w: l('Genel bakış → Haftalık özet', 'Overview → Weekly review'),
    p: l('Özet yalnızca projenizin son yedi günlük kayıtlarından hazırlanır: yapılan işler, ölçümler, bağlantılar. Önerilen ayarlamaları kabul edin ya da reddedin; kabul etmek planı değiştirir ve sahip veya yönetici yetkisi ister. İsterseniz özeti e-postayla alabilirsiniz (doğrulanmış e-posta gerekir).', 'The review is built only from your project’s records for the last seven days: work done, measurements, connections. Accept or reject the proposed adjustments; accepting changes the plan and needs owner or admin rights. You can also get the review by email (a verified email is required).') },
];

const MONTH = [
  { t: l('Aylık yenileme', 'Monthly renewal'), w: l('Genel bakış → Aylık yenileme', 'Overview → Monthly renewal'),
    p: l('30 günlük planın son haftasında açılır. Bitmeyen işler yeni plana taşınır, bitenler çıkar, hiç iş yapılmayan kanal sona alınır. Her değişikliğin gerekçesi yanında yazar. Onaylandığında yeni 30 gün başlar.', 'It opens in the last week of the 30-day plan. Unfinished work moves into the new plan, finished work drops out and a channel with no work moves to the end. Every change shows its reason. Once approved, a new 30 days begins.') },
  { t: l('Ne öğrendik', 'What we learned'), w: l('Analitik → Büyüme koçu: ne öğrendik', 'Analytics → Growth coach: what we learned'),
    p: l('Koçtan açılan taslakların yayınları ve sağlayıcının bildirdiği etkileşim, kanal ve temaya göre yan yana gelir. Bir kanal ancak yeterli gözlem varsa öne çıkar ve bu bir gözlemdir, neden-sonuç kanıtı değildir.', 'Publications of drafts opened from the coach and the engagement the provider reported are shown side by side by channel and theme. A channel is named only with enough observations, and that is an observation, not proof of cause.') },
];

const TOOLS = [
  { t: l('İçerik stüdyosu', 'Content studio'), p: l('Sosyal medya gönderisi, blog ve e-posta taslakları. Onaylı briefinizi ve marka dilinizi kullanır.', 'Drafts for social posts, blogs and email. Uses your approved brief and brand voice.') },
  { t: l('Takvim → İçerik planı', 'Calendar → Content plan'), p: l('Ayın içerik önerileri. Onaylayın, stüdyoda açın ya da takvime ekleyin.', 'Content suggestions for the month. Approve them, open them in the studio or add them to the Calendar.') },
  { t: l('SEO & Blog → Konular ve içerik briefleri', 'SEO & Blog → Topics & content briefs'), p: l('Ne hakkında yazmalı ve nasıl. Search Console bağlıysa gerçek arama sorgularınız görünür; değilse konular doğrulanacak öneridir.', 'What to write about and how. With Search Console connected you see your real search queries; otherwise topics are suggestions to check.') },
  { t: l('SEO & Blog → Site denetimi', 'SEO & Blog → Site audit'), p: l('Sitenizin herkese açık sayfasındaki sorunları olası etkisine göre sıralar. Geliştiriciye verilecek görev metnini tek tıkla kopyalarsınız.', 'Ranks the issues on your public site by likely impact. Copy a ready task for your developer in one click.') },
  { t: l('Kampanyalar', 'Campaigns'), p: l('E-posta kampanyası taslakları. Gönderim; izin, inceleme ve pilot sınırlarından geçer.', 'Email campaign drafts. Sending goes through consent, review and pilot limits.') },
  { t: l('Kampanyalar → Reklamlar', 'Campaigns → Ads'), p: l('Meta, Google Ads veya LinkedIn reklamları; harcama tavanını siz yazarsınız. Kampanya duraklatılmış oluşturulur ve ancak onayla başlar.', 'Meta, Google Ads or LinkedIn ads with a spending cap you set. A campaign is created paused and starts only after approval.') },
  { t: l('Kampanyalar → WhatsApp ve Gelen kutusu', 'Campaigns → WhatsApp and Inbox'), p: l('İzin vermiş kişilere onaylı şablonlarla mesaj; size yazılan mesajlar ve yorumlar gelen kutusunda toplanır, yanıtı ekip yazar ve onaylar.', 'Approved-template messages to people who gave consent; messages and comments sent to you gather in the inbox, and the team writes and approves each reply.') },
  { t: l('Proje ayarları → Marka dili & rakipler', 'Project settings → Brand voice & competitors'), p: l('Ses tonu atölyesi ve kendi rakip notlarınız; konumlandırma önerisi. Rakip adresleri ziyaret edilmez.', 'A tone-of-voice workshop and your own competitor notes; a positioning suggestion. Competitor addresses are never visited.') },
];

const ROLES = [
  { r: l('Sahip', 'Owner'), p: l('Her şey; ayrıca plan satın alma ve sahipliği devretme.', 'Everything, plus buying a plan and transferring ownership.') },
  { r: l('Yönetici', 'Admin'), p: l('Briefi, aylık yenilemeyi ve plan değişikliklerini onaylar; bağlantıları ve ekibi yönetir.', 'Approves the brief, the monthly renewal and plan changes; manages connections and the team.') },
  { r: l('Editör', 'Editor'), p: l('Teşhisi yapar, taslak, içerik planı, SEO briefi ve haftalık özet hazırlar; önerileri reddedebilir.', 'Runs the diagnosis, prepares drafts, the content plan, SEO briefs and the weekly review; can reject proposals.') },
  { r: l('Analist / Görüntüleyici', 'Analyst / Viewer'), p: l('Brief, plan, özet ve ölçümleri görür; değiştirmez.', 'Sees the brief, plan, reviews and measurements; doesn’t change them.') },
];

const TERMS = [
  { t: l('İdeal müşteri', 'Ideal customer'), p: l('Ürününüzden en çok fayda gören ve satın almaya en yakın kişi ya da işletme tipi.', 'The type of person or business that benefits most from your product and is closest to buying.') },
  { t: l('Konumlandırma', 'Positioning'), p: l('Müşterinin sizi neden seçmesi gerektiğini anlatan tek cümle: kime, hangi sorun için, alternatiflerden farkınız ne.', 'One sentence on why a customer should choose you: for whom, for which problem, and how you differ from the alternatives.') },
  { t: l('Brief', 'Brief'), p: l('Bir işin kısa yönergesi. Strateji briefi tüm planı, içerik briefi tek bir yazıyı yönlendirir.', 'Short instructions for a piece of work. The strategy brief guides the whole plan; a content brief guides one piece.') },
  { t: l('Kanal', 'Channel'), p: l('Müşteriye ulaştığınız yer: LinkedIn, Instagram, e-posta, arama motoru gibi.', 'Where you reach customers: LinkedIn, Instagram, email, search and so on.') },
  { t: l('Dönüşüm aşaması', 'Conversion stage'), p: l('Hedefinize giden yoldaki adımlar; örneğin talep → görüşme → teklif → satış.', 'The steps on the way to your goal, for example request → meeting → proposal → sale.') },
  { t: l('SEO ve arama niyeti', 'SEO and search intent'), p: l('Arama motorlarında bulunabilmek için yapılan çalışma. Arama niyeti, arayanın bilgi mi aradığını yoksa satın almaya mı hazır olduğunu anlatır.', 'Work that helps you be found in search engines. Search intent describes whether the searcher wants information or is ready to buy.') },
  { t: l('Gösterim, erişim, etkileşim', 'Impressions, reach, engagement'), p: l('Gösterim içeriğin kaç kez görüntülendiği, erişim kaç farklı kişiye ulaştığı, etkileşim beğeni, yorum, paylaşım ve tıklamalardır.', 'Impressions are how often content was shown, reach is how many different people saw it, and engagement is likes, comments, shares and clicks.') },
];

const FAQ = [
  { q: l('AI düğmesini göremiyorum.', 'I can’t see the AI button.'), a: l('AI sağlayıcısı yapılandırılmamış olabilir. Kurallı başlangıç şablonu aynı akışı AI kullanmadan çalıştırır; plan yine sizin yanıtlarınızdan oluşur.', 'The AI provider may not be configured. The rule-based starter runs the same flow without AI; the plan still comes from your answers.') },
  { q: l('“Onayla” düğmesi yok.', 'There is no “Approve” button.'), a: l('Rolünüz onaya izin vermiyor. Taslağı kaydedin; sahip veya yönetici onaylar.', 'Your role can’t approve. Save the draft and an owner or admin approves it.') },
  { q: l('Ekranda “veri yok” yazıyor.', 'The screen says “no data”.'), a: l('Kaynak bağlı değil ya da o hafta ölçüm girilmedi. Bu bir sıfır sonuç değildir; ölçüm girdiğinizde ya da bağlantı kurduğunuzda dolar.', 'The source isn’t connected or no measurement was entered that week. It isn’t a zero result; it fills in once you measure or connect.') },
  { q: l('Search Console sorgularını göremiyorum.', 'I can’t see Search Console queries.'), a: l('Bu veriler yalnız bağlantıları yöneten ekip üyelerine (sahip, yönetici) açıktır. Konularınız yine ürün profilinizden ve briefinizden hazırlanır.', 'This data is only available to teammates who manage connections (owner, admin). Your topics are still prepared from your product profile and brief.') },
  { q: l('Bir şey benim yerime yayınlandı mı?', 'Did anything get published for me?'), a: l('Hayır. Pilotta otomatik yayın ve toplu gönderim kapalıdır; her yayın ve gönderim bir insan kararıdır.', 'No. In the pilot, automatic publishing and bulk sending are off; every release is a human decision.') },
];

export default async function GuidePage({ searchParams }: Props) {
  const lang: Lang = await requestLang((await searchParams).lang);
  const t = (tr: string, en: string) => (lang === 'en' ? en : tr);
  const tx = (value: L) => value[lang];
  const steps = (items: { t: L; w: L; p: L }[]) => <ol className="rd-steps">{items.map(item => <li key={item.t.tr}><strong>{tx(item.t)}</strong><p>{tx(item.p)}</p><span className="rd-where">{tx(item.w)}</span></li>)}</ol>;
  const toc = [
    { id: 'rules', title: t('Önce üç kural', 'Three rules first') },
    { id: 'first-day', title: t('İlk gün', 'Day one') },
    { id: 'week', title: t('Her hafta', 'Every week') },
    { id: 'month', title: t('Ay sonunda', 'At the end of the month') },
    { id: 'tools', title: t('Hangi araç ne işe yarar', 'What each tool is for') },
    { id: 'roles', title: t('Roller', 'Roles') },
    { id: 'terms', title: t('Kısa sözlük', 'Short glossary') },
    { id: 'faq', title: t('Sık takılınan yerler', 'Common sticking points') },
    { id: 'feedback', title: t('Pilot geri bildirimi', 'Pilot feedback') },
  ];
  return (
    <DocShell
      lang={lang}
      kicker={t('Kullanım rehberi', 'User guide')}
      title={t('Pazarlama uzmanınız yoksa Ryzevo’yu nasıl kullanırsınız', 'How to use Ryzevo without a marketing specialist')}
      lead={t('Bu rehber SEO, sosyal medya veya dijital pazarlama deneyimi olmayan ya da az olan ekipler için. İlk gün teşhisi yapıp briefi onaylarsınız; sonra her hafta birkaç küçük işle ilerlersiniz. Ne kadar zaman ayıracağınızı siz söylersiniz, plan buna göre kısalır.',
        'This guide is for teams with little or no SEO, social media or digital marketing experience. On day one you run the diagnosis and approve the brief; after that you move forward with a few small tasks each week. You say how much time you have, and the plan fits it.')}
      toc={toc}
    >
      <section id="rules">
        <h2>{t('Önce üç kural', 'Three rules first')}</h2>
        <ul className="rd-rules">{RULES.map(rule => <li key={rule.t.tr}><strong>{tx(rule.t)}</strong> {tx(rule.p)}</li>)}</ul>
      </section>

      <section id="first-day">
        <h2>{t('İlk gün', 'Day one')}</h2>
        <p>{t('Tahmini süre bir saatten azdır; çoğu teşhis sorularına ve briefi okumaya gider.', 'Expect it to take under an hour, mostly for the diagnosis questions and reading the brief.')}</p>
        {steps(FIRST_DAY)}
      </section>

      <section id="week">
        <h2>{t('Her hafta', 'Every week')}</h2>
        <p>{t('Haftalık ritim dört adımdır. Haftalar projenizin saat diliminde pazartesi başlar.', 'The weekly rhythm has four steps. Weeks start on Monday in your project’s time zone.')}</p>
        {steps(WEEK)}
      </section>

      <section id="month">
        <h2>{t('Ay sonunda', 'At the end of the month')}</h2>
        {steps(MONTH)}
      </section>

      <section id="tools">
        <h2>{t('Hangi araç ne işe yarar', 'What each tool is for')}</h2>
        <p>{t('Koç sizi doğru araca götürür; yine de hangisinin ne yaptığını bilmek işinizi kolaylaştırır.', 'The coach takes you to the right tool, but it helps to know what each one does.')}</p>
        <div className="rd-cards">{TOOLS.map(tool => <div key={tool.t.tr} className="rd-card"><strong>{tx(tool.t)}</strong><p>{tx(tool.p)}</p></div>)}</div>
      </section>

      <section id="roles">
        <h2>{t('Roller', 'Roles')}</h2>
        <div className="rd-table"><table>
          <thead><tr><th>{t('Rol', 'Role')}</th><th>{t('Ne yapabilir', 'What they can do')}</th></tr></thead>
          <tbody>{ROLES.map(role => <tr key={role.r.tr}><td><strong>{tx(role.r)}</strong></td><td>{tx(role.p)}</td></tr>)}</tbody>
        </table></div>
        <p className="rd-small">{t('Küçük bir ekipte genellikle bir kişi sahip, diğerleri editör olur.', 'In a small team, one person is usually the owner and the others are editors.')}</p>
      </section>

      <section id="terms">
        <h2>{t('Kısa sözlük', 'Short glossary')}</h2>
        <dl className="rd-dl">{TERMS.map(term => <Fragment key={term.t.tr}><dt>{tx(term.t)}</dt><dd>{tx(term.p)}</dd></Fragment>)}</dl>
      </section>

      <section id="faq" className="rd-faq">
        <h2>{t('Sık takılınan yerler', 'Common sticking points')}</h2>
        {FAQ.map(item => <details key={item.q.tr}><summary>{tx(item.q)}</summary><p>{tx(item.a)}</p></details>)}
      </section>

      <section id="feedback">
        <h2>{t('Pilot geri bildirimi', 'Pilot feedback')}</h2>
        <p>{t('Takıldığınız her yeri kısaca not edin: hangi ekrandaydınız, ne yapmak istediniz, ne oldu. Notlarınızı pilot sorumlunuza iletin; rehber ve ürün bu notlarla güncellenir.',
          'Jot down every place you get stuck: which screen you were on, what you wanted to do and what happened. Send your notes to your pilot contact; the guide and the product are updated from them.')}</p>
      </section>
    </DocShell>
  );
}
