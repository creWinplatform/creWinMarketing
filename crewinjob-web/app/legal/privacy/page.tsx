import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import DocShell from '@/components/marketing/DocShell';
import { requestLang } from '@/lib/i18n/server';
import type { Lang } from '@/lib/i18n/shared';
import { INBOX_LIMITS } from '@/lib/platform/social-inbox-types';
import {
  PRIVACY_HOSTING_LOCATION, PRIVACY_RETENTION, PRIVACY_VERBIS, PRIVACY_VERSION, SALES_SELLER, privacyReady,
} from '@/lib/platform/sales-terms';

// KVKK (6698 sayılı Kanun) md. 10 ve Aydınlatma Yükümlülüğü Tebliği kapsamında aydınlatma metni.
// TASLAK: veri sorumlusu bilgileri, barındırma yeri, saklama süreleri ve hukuki onay lib/platform/sales-terms.ts içinde
// tamamlanana kadar sayfa taslak etiketli ve noindex. Yalnız kodun gerçekten işlediği veriler yazılır; yeni bir veri
// işleme eklendiğinde bu metin de güncellenmeli. Türkçe metin esastır.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = await requestLang((await searchParams).lang);
  return {
    title: lang === 'en' ? 'Privacy notice' : 'Kişisel verilerin işlenmesine ilişkin aydınlatma metni',
    description: lang === 'en'
      ? 'How Ryzevo processes personal data under the Turkish Personal Data Protection Law (KVKK).'
      : 'Ryzevo’nun kişisel verileri 6698 sayılı KVKK kapsamında nasıl işlediği.',
    robots: privacyReady() ? undefined : { index: false, follow: false },
    alternates: { languages: { tr: '/legal/privacy?lang=tr', en: '/legal/privacy?lang=en' } },
  };
}

export default async function PrivacyPage({ searchParams }: Props) {
  const lang: Lang = await requestLang((await searchParams).lang);
  const en = lang === 'en';
  const t = (tr: ReactNode, eng: ReactNode) => (en ? eng : tr);
  const ts = (tr: string, eng: string) => (en ? eng : tr);
  const ph = (tr: string, eng: string) => <mark className="rd-ph">[{en ? eng : tr}]</mark>;
  const field = (value: string, tr: string, eng: string) => value.trim() ? value : ph(tr, eng);
  const s = SALES_SELLER, ready = privacyReady();
  const controller = field(s.name, 'Veri sorumlusu unvanı — doldurulacak', 'Controller’s legal name — to be completed');
  const email = field(s.email, 'başvuru e-postası — doldurulacak', 'request email — to be completed');
  const retention = (value: string) => field(value, 'süre — hukuk incelemesi', 'period — legal review');

  const toc = [
    { id: 'controller', title: ts('1. Veri sorumlusu', '1. Controller') },
    { id: 'roles', title: ts('2. Kimin verisi, kimin adına', '2. Whose data, on whose behalf') },
    { id: 'data', title: ts('3. İşlenen veriler ve amaçlar', '3. Data and purposes') },
    { id: 'basis', title: ts('4. Hukuki sebepler', '4. Legal grounds') },
    { id: 'transfer', title: ts('5. Aktarım', '5. Transfers') },
    { id: 'retention', title: ts('6. Saklama ve güvenlik', '6. Retention and security') },
    { id: 'cookies', title: ts('7. Çerezler', '7. Cookies') },
    { id: 'rights', title: ts('8. Haklarınız ve başvuru', '8. Your rights') },
  ];

  const rows: { what: [string, string]; purpose: [string, string]; how: [string, string] }[] = [
    { what: ['Hesap: kullanıcı adı, şifrenin özeti, doğrulanmış e-posta, rol ve proje üyelikleri', 'Account: username, password hash, verified email, role and project memberships'],
      purpose: ['Giriş, hesap kurtarma, ekip yetkileri', 'Sign-in, account recovery, team permissions'], how: ['Kayıt ve davet ekranları', 'Sign-up and invitation screens'] },
    { what: ['İşlem kayıtları: hangi kullanıcının hangi işlemi ne zaman yaptığı', 'Activity records: which user did which action and when'],
      purpose: ['Güvenlik, hata ve kötüye kullanım incelemesi, onay geçmişi', 'Security, error and abuse review, approval history'], how: ['Uygulama otomatik tutar', 'Kept automatically by the app'] },
    { what: ['Proje içeriği: ürün profili, hedefler, teşhis yanıtları, taslaklar, kampanyalar, takvim, ölçümler', 'Project content: product profile, goals, diagnosis answers, drafts, campaigns, calendar, measurements'],
      purpose: ['Hizmetin sunulması', 'Providing the service'], how: ['Ekibinizin girdiği bilgiler', 'What your team enters'] },
    { what: ['Bağlı hesap erişimleri: Google, LinkedIn, Meta, X, WhatsApp ve reklam hesapları için erişim anahtarları', 'Connected account access: access tokens for Google, LinkedIn, Meta, X, WhatsApp and ad accounts'],
      purpose: ['Ölçüm okuma, onaylı yayın ve gönderim', 'Reading measurements, approved publishing and sending'], how: ['Hesap sahibinin verdiği izin; şifreli saklanır', 'Permission granted by the account owner; stored encrypted'] },
    { what: ['Alıcı ve kişi listeleri: e-posta adresleri, WhatsApp numaraları, izin kanıtı, abonelikten çıkma kayıtları', 'Recipient and contact lists: email addresses, WhatsApp numbers, consent evidence, unsubscribe records'],
      purpose: ['Ekibinizin onayladığı e-posta ve WhatsApp gönderimleri; çıkış isteğine uyulması', 'Email and WhatsApp sends your team approves; honouring opt-outs'], how: ['Ekibiniz yükler; numaralar şifreli saklanır', 'Uploaded by your team; numbers stored encrypted'] },
    { what: ['Gelen kutusu: gönderilerinize yorumlar ve size gelen Facebook, Instagram, WhatsApp mesajları', 'Inbox: comments on your posts and Facebook, Instagram and WhatsApp messages to you'],
      purpose: ['Ekibinizin yanıt vermesi', 'Letting your team reply'], how: ['Bağlı hesaplar; metindeki e-posta ve telefonlar gizlenir, gönderen kimliği açık saklanmaz', 'Connected accounts; emails and phone numbers in the text are masked and sender identity is not stored in clear'] },
    { what: ['Ödeme: plan, tutar, sipariş durumu; ad, telefon, adres ve e-posta yalnızca PayTR’a iletilir', 'Payment: plan, amount, order status; name, phone, address and email are only passed to PayTR'],
      purpose: ['Satın alma ve faturalama', 'Purchase and invoicing'], how: ['Ödeme formu; kart bilgisi Ryzevo’ya ulaşmaz', 'Payment form; card details never reach Ryzevo'] },
  ];

  return (
    <DocShell
      lang={lang}
      kicker={ts('Yasal', 'Legal')}
      title={ts('Kişisel verilerin işlenmesine ilişkin aydınlatma metni', 'Privacy notice')}
      lead={t('Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu’nun (KVKK) 10. maddesi uyarınca Ryzevo’yu kullanırken hangi kişisel verilerin, hangi amaçla ve nasıl işlendiğini ve haklarınızı anlatır.',
        'This notice explains, under Article 10 of the Turkish Personal Data Protection Law No. 6698 (KVKK), which personal data is processed when you use Ryzevo, why and how, and what your rights are.')}
      meta={<>{ts('Sürüm', 'Version')} {PRIVACY_VERSION}{en && ' · The Turkish text prevails; this English version is a translation for information.'}</>}
      toc={toc}
      notice={!ready && <div className="rd-notice" role="note"><strong>{ts('Taslak metin', 'Draft text')}</strong>{ts(
        'Veri sorumlusu bilgileri, barındırma yeri, saklama süreleri ve hukuki inceleme tamamlanmadı. Sarı işaretli alanlar doldurulup metin onaylanana kadar bu sayfa yayımlanmış sayılmaz.',
        'The controller details, hosting location, retention periods and legal review are not complete. This page does not count as published until the highlighted fields are filled in and the text is approved.')}</div>}
    >
      <section id="controller">
        <h2>{t('1. Veri sorumlusu', '1. Controller')}</h2>
        <dl className="rd-dl">
          <dt>{t('Unvan', 'Legal name')}</dt><dd>{controller}</dd>
          <dt>{t('Adres', 'Address')}</dt><dd>{field(s.address, 'açık adres — doldurulacak', 'full address — to be completed')}</dd>
          <dt>{t('E-posta', 'Email')}</dt><dd>{email}</dd>
          {s.kep.trim() && <><dt>KEP</dt><dd>{s.kep}</dd></>}
          {PRIVACY_VERBIS.trim() && <><dt>VERBİS</dt><dd>{PRIVACY_VERBIS}</dd></>}
        </dl>
      </section>

      <section id="roles">
        <h2>{t('2. Kimin verisi, kimin adına', '2. Whose data, on whose behalf')}</h2>
        <ul>
          <li>{t(<><strong>Ryzevo kullanıcıları</strong> (hesap sahipleri ve ekip üyeleri) ile <strong>satın alma yapanlar</strong> için {controller} veri sorumlusudur.</>,
            <>For <strong>Ryzevo users</strong> (account holders and team members) and <strong>buyers</strong>, {controller} is the controller.</>)}</li>
          <li>{t(<>Müşterilerimizin kendi işleri için Ryzevo’ya yüklediği veya bağladığı veriler (alıcı listeleri, WhatsApp kişileri, gelen kutusundaki yorum ve mesajlar, ölçümler) için <strong>veri sorumlusu ilgili müşteridir</strong>; Ryzevo bu verileri müşterinin talimatıyla ve yalnızca hizmeti sunmak için işleyen <strong>veri işleyendir</strong>. Bu verilerle ilgili taleplerinizi önce o işletmeye iletin.</>,
            <>For data our customers upload or connect for their own business (recipient lists, WhatsApp contacts, comments and messages in the inbox, measurements), <strong>the customer is the controller</strong>; Ryzevo is a <strong>processor</strong> that handles it on the customer’s instructions and only to provide the service. Send requests about such data to that business first.</>)}</li>
          <li>{t('Ryzevo landing sayfasında ve standart çalışma alanında analitik veya reklam izleme kodu kullanılmaz.', 'No analytics or advertising tracking code is used on the Ryzevo landing page or in the standard workspace.')}</li>
        </ul>
      </section>

      <section id="data">
        <h2>{t('3. İşlenen veriler ve amaçlar', '3. Data and purposes')}</h2>
        <div className="rd-table"><table>
          <thead><tr><th>{t('Veri', 'Data')}</th><th>{t('Amaç', 'Purpose')}</th><th>{t('Nasıl toplanır', 'How it is collected')}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.what[0]}><td>{row.what[en ? 1 : 0]}</td><td>{row.purpose[en ? 1 : 0]}</td><td>{row.how[en ? 1 : 0]}</td></tr>)}</tbody>
        </table></div>
        <p>{t('Veriler elektronik ortamda, kısmen otomatik yollarla toplanır. AI destekli özellikler kullanıldığında, istenen taslak için gereken proje bilgileri ve metinler (örneğin teşhis yanıtları ya da gizlenmiş bir mesaj metni) AI sağlayıcısına gönderilir; AI çıktısı ekip onaylamadan yayınlanmaz veya gönderilmez.',
          'Data is collected electronically, partly by automated means. When AI-assisted features are used, the project information and text needed for the requested draft (for example diagnosis answers or a masked message text) are sent to the AI provider; AI output is never published or sent without the team’s approval.')}</p>
      </section>

      <section id="basis">
        <h2>{t('4. Hukuki sebepler', '4. Legal grounds')}</h2>
        <ul>
          <li>{t('Sözleşmenin kurulması ve ifası (KVKK md. 5/2-c): hesap, proje içeriği, bağlı hesaplar ve ödeme.', 'Making and performing the contract (KVKK Art. 5/2-c): account, project content, connected accounts and payment.')}</li>
          <li>{t('Hukuki yükümlülük (md. 5/2-ç): fatura ve muhasebe kayıtları, yetkili makam talepleri.', 'Legal obligation (Art. 5/2-ç): invoice and accounting records, requests from competent authorities.')}</li>
          <li>{t('Meşru menfaat (md. 5/2-f): işlem kayıtları ile hizmetin güvenliği ve kötüye kullanımın önlenmesi.', 'Legitimate interest (Art. 5/2-f): activity records, service security and abuse prevention.')}</li>
          <li>{t('Yurt dışına aktarım için KVKK md. 9’da öngörülen şartlar (aşağıda).', 'For transfers abroad, the conditions in KVKK Art. 9 (below).')}</li>
        </ul>
      </section>

      <section id="transfer">
        <h2>{t('5. Aktarım', '5. Transfers')}</h2>
        <p>{t('Kişisel veriler yalnızca hizmetin gerektirdiği ölçüde ve aşağıdaki alıcılara aktarılır:', 'Personal data is shared only as far as the service requires, with the following recipients:')}</p>
        <ul>
          <li>{t(<>Barındırma ve yedekleme: Amazon Web Services ({field(PRIVACY_HOSTING_LOCATION, 'bölge — doldurulacak', 'region — to be completed')}).</>, <>Hosting and backups: Amazon Web Services ({field(PRIVACY_HOSTING_LOCATION, 'bölge — doldurulacak', 'region — to be completed')}).</>)}</li>
          <li>{t('E-posta gönderimi: Amazon SES (hesap doğrulama, şifre kurtarma, onaylı kampanya ve haftalık özet e-postaları).', 'Email delivery: Amazon SES (account verification, password recovery, approved campaign and weekly review emails).')}</li>
          <li>{t('AI sağlayıcısı: Google (Gemini), AI özellikleri kullanıldığında.', 'AI provider: Google (Gemini), when AI features are used.')}</li>
          <li>{t('Bağladığınız platformlar: Google (Analytics, Search Console, Ads), LinkedIn, Meta (Facebook, Instagram, WhatsApp), X, Telegram; yalnızca sizin onayladığınız okuma, yayın ve gönderim işlemleri için.', 'Platforms you connect: Google (Analytics, Search Console, Ads), LinkedIn, Meta (Facebook, Instagram, WhatsApp), X, Telegram; only for the reading, publishing and sending you approve.')}</li>
          <li>{t('Ödeme: PayTR Ödeme ve Elektronik Para Kuruluşu A.Ş.', 'Payments: PayTR Ödeme ve Elektronik Para Kuruluşu A.Ş.')}</li>
          <li>{t('Kanunen yetkili kamu kurum ve kuruluşları, talep halinde.', 'Public authorities legally entitled to request it, on request.')}</li>
        </ul>
        <p>{t('Bu sağlayıcıların bir kısmının sunucuları yurt dışındadır. Yurt dışına aktarım, KVKK md. 9’daki şartlara (uygun güvenceler, standart sözleşme veya istisnalar) uygun olarak yapılır.',
          'Some of these providers have servers outside Turkey. Transfers abroad follow the conditions in KVKK Art. 9 (appropriate safeguards, standard contracts or exceptions).')} {ph('aktarım dayanağı her sağlayıcı için — hukuk incelemesi', 'transfer basis for each provider — legal review')}</p>
      </section>

      <section id="retention">
        <h2>{t('6. Saklama ve güvenlik', '6. Retention and security')}</h2>
        <ul>
          <li>{t(<>Hesap ve proje kayıtları: {retention(PRIVACY_RETENTION.account)}.</>, <>Account and project records: {retention(PRIVACY_RETENTION.account)}.</>)}</li>
          <li>{t(<>İşlem kayıtları: {retention(PRIVACY_RETENTION.audit)}.</>, <>Activity records: {retention(PRIVACY_RETENTION.audit)}.</>)}</li>
          <li>{t(<>Yedekler: {retention(PRIVACY_RETENTION.backups)}.</>, <>Backups: {retention(PRIVACY_RETENTION.backups)}.</>)}</li>
          <li>{t(`Gelen kutusu kayıtları: ${INBOX_LIMITS.retentionDays} gün sonra otomatik silinir.`, `Inbox items: deleted automatically after ${INBOX_LIMITS.retentionDays} days.`)}</li>
          <li>{t('Abonelikten çıkma ve izin geri çekme kayıtları, kişiye tekrar ileti gönderilmemesi için tutulur.', 'Unsubscribe and consent-withdrawal records are kept so the person is not messaged again.')}</li>
        </ul>
        <p>{t('Şifreler yalnızca özet olarak, bağlı hesap erişimleri ve telefon numaraları şifreli saklanır. Erişim, ekip rolleriyle sınırlanır ve önemli işlemler kayıt altına alınır. Süresi dolan veriler silinir, yok edilir veya anonim hale getirilir.',
          'Passwords are stored only as hashes; connected account access and phone numbers are stored encrypted. Access is limited by team roles and important actions are logged. Data past its period is deleted, destroyed or anonymised.')}</p>
      </section>

      <section id="cookies">
        <h2>{t('7. Çerezler', '7. Cookies')}</h2>
        <ul>
          <li>{t('Oturum çerezi: giriş yaptığınızı hatırlar; zorunludur.', 'Session cookie: remembers that you are signed in; strictly necessary.')}</li>
          <li>{t('Dil çerezi (ryzevo_lang): seçtiğiniz dili hatırlar.', 'Language cookie (ryzevo_lang): remembers the language you chose.')}</li>
          <li>{t('Bağlantı güvenlik çerezleri: Google, LinkedIn veya Meta hesabı bağlarken kısa süreliğine kullanılır ve işlem bitince silinir.', 'Connection security cookies: used briefly while connecting a Google, LinkedIn or Meta account and removed when it finishes.')}</li>
        </ul>
        <p>{t('Tema tercihi yalnızca tarayıcınızda saklanır. Analitik veya reklam çerezi kullanılmaz.', 'Your theme choice is stored only in your browser. No analytics or advertising cookies are used.')}</p>
      </section>

      <section id="rights">
        <h2>{t('8. Haklarınız ve başvuru', '8. Your rights')}</h2>
        <p>{t('KVKK md. 11 uyarınca; verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, şartları oluşmuşsa silinmesini veya yok edilmesini ve bunların aktarılan kişilere bildirilmesini isteme, yalnızca otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuca itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız halinde giderilmesini talep etme haklarına sahipsiniz.',
          'Under KVKK Art. 11 you may: learn whether your data is processed and request information about it; learn the purpose and whether it is used accordingly; know the third parties it is shared with; ask for incomplete or wrong data to be corrected, and for deletion or destruction where the conditions are met, and for these to be notified to recipients; object to an outcome against you that results solely from automated analysis; and claim compensation for damage caused by unlawful processing.')}</p>
        <p>{t(<>Başvurunuzu, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ’e uygun olarak yazılı olarak yukarıdaki adrese, kayıtlı elektronik posta (KEP) ile ya da sistemimizde kayıtlı e-posta adresinizden {email} adresine iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz yanıtlanır; işlem ayrıca bir maliyet gerektirirse Kurulca belirlenen tarife uygulanabilir.</>,
          <>You can send your request in writing to the address above, by registered electronic mail (KEP), or from the email address registered with us to {email}, in line with the Communiqué on the Procedures for Applications to the Controller. Requests are answered free of charge within 30 days at the latest; if handling it involves a separate cost, the tariff set by the Board may apply.</>)}</p>
        <p className="rd-small">{ts('Sürüm', 'Version')} {PRIVACY_VERSION}</p>
      </section>
    </DocShell>
  );
}
