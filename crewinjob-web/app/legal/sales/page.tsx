import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import DocShell from '@/components/marketing/DocShell';
import { requestLang } from '@/lib/i18n/server';
import type { Lang } from '@/lib/i18n/shared';
import { PLAN_CATALOG } from '@/lib/platform/plan-catalog';
import {
  SALES_INVOICE_DAYS, SALES_MERCHANT_COURT, SALES_PRICES_INCLUDE_VAT, SALES_PRIVACY_URL, SALES_SELLER,
  SALES_TERMS_VERSION, salesTermsReady,
} from '@/lib/platform/sales-terms';

// Ön bilgilendirme formu + mesafeli satış sözleşmesi (6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği).
// TASLAK: satıcı bilgileri, KDV, fatura süresi, yetkili mahkeme ve hukuki onay lib/platform/sales-terms.ts içinde
// tamamlanana kadar sayfa taslak etiketli ve noindex; canlı ödeme bu adresle açılmaz. Fiyatlar PLAN_CATALOG'dan gelir.
// Türkçe metin esastır; İngilizce metin bilgi amaçlı çeviridir.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = await requestLang((await searchParams).lang);
  const ready = salesTermsReady();
  return {
    title: lang === 'en' ? 'Pre-contract information and terms of sale' : 'Ön bilgilendirme formu ve mesafeli satış sözleşmesi',
    description: lang === 'en'
      ? 'The pre-contract information and distance sales contract for prepaid Ryzevo plans.'
      : 'Ön ödemeli Ryzevo planları için ön bilgilendirme formu ve mesafeli satış sözleşmesi.',
    robots: ready ? undefined : { index: false, follow: false },
    alternates: { languages: { tr: '/legal/sales?lang=tr', en: '/legal/sales?lang=en' } },
  };
}

const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default async function SalesTermsPage({ searchParams }: Props) {
  const lang: Lang = await requestLang((await searchParams).lang);
  const en = lang === 'en';
  const t = (tr: ReactNode, eng: ReactNode) => (en ? eng : tr);
  const ts = (tr: string, eng: string) => (en ? eng : tr);
  const ready = salesTermsReady();
  const ph = (tr: string, eng: string) => <mark className="rd-ph">[{en ? eng : tr}]</mark>;
  const field = (value: string, tr: string, eng: string) => value.trim() ? value : ph(tr, eng);
  const s = SALES_SELLER;
  const sellerName = field(s.name, 'Satıcı unvanı — doldurulacak', 'Seller’s legal name — to be completed');
  const plans = PLAN_CATALOG.filter(plan => plan.availability === 'planned');
  const vat = SALES_PRICES_INCLUDE_VAT === null
    ? ph('KDV dahil mi, hariç mi — muhasebe teyidi', 'VAT included or excluded — to be confirmed by accounting')
    : SALES_PRICES_INCLUDE_VAT ? t('Fiyatlara KDV dahildir.', 'Prices include VAT.') : t('Fiyatlara KDV eklenir; ödeme sayfasında KDV dahil toplam gösterilir.', 'VAT is added to the prices; the payment page shows the total including VAT.');
  const invoice = SALES_INVOICE_DAYS ? t(`${SALES_INVOICE_DAYS} gün`, `${SALES_INVOICE_DAYS} days`) : ph('fatura süresi — muhasebe teyidi', 'invoice period — to be confirmed by accounting');
  const privacy = /^https:\/\//.test(SALES_PRIVACY_URL)
    ? <a href={SALES_PRIVACY_URL}>{t('kişisel verilerin işlenmesine ilişkin aydınlatma metni', 'privacy notice')}</a>
    : <>{t('kişisel verilerin işlenmesine ilişkin aydınlatma metni', 'privacy notice')} {ph('bağlantı eklenecek', 'link to be added')}</>;

  const toc = [
    { id: 'pre', title: ts('A. Ön bilgilendirme formu', 'A. Pre-contract information') },
    { id: 'seller', title: ts('1. Satıcı', '1. Seller') },
    { id: 'service', title: ts('2. Hizmet', '2. The service') },
    { id: 'price', title: ts('3. Planlar ve fiyatlar', '3. Plans and prices') },
    { id: 'payment', title: ts('4. Ödeme ve ifa', '4. Payment and performance') },
    { id: 'term', title: ts('5. Süre ve yenileme', '5. Term and renewal') },
    { id: 'withdrawal', title: ts('6. Cayma hakkı', '6. Right of withdrawal') },
    { id: 'technical', title: ts('7. Teknik koşullar', '7. Technical requirements') },
    { id: 'complaints', title: ts('8. Şikâyet ve başvuru', '8. Complaints') },
    { id: 'contract', title: ts('B. Mesafeli satış sözleşmesi', 'B. Distance sales contract') },
  ];

  return (
    <DocShell
      lang={lang}
      kicker={ts('Yasal', 'Legal')}
      title={ts('Ön bilgilendirme formu ve mesafeli satış sözleşmesi', 'Pre-contract information and distance sales contract')}
      lead={t(
        'Ryzevo planını ryzevo.com üzerinden satın alırken bu iki metni onaylarsınız: önce ön bilgilendirme formu, ardından mesafeli satış sözleşmesi. Ödeme formundaki onay kutusunu işaretlemeniz, metinleri okuduğunuzu ve kabul ettiğinizi gösterir.',
        'When you buy a Ryzevo plan on ryzevo.com you accept these two texts: first the pre-contract information, then the distance sales contract. Ticking the box on the payment form confirms that you have read and accepted them.')}
      meta={<>{t('Sürüm', 'Version')} {SALES_TERMS_VERSION}{en && ' · The Turkish text prevails; this English version is a translation for information.'}</>}
      toc={toc}
      notice={!ready && <div className="rd-notice" role="note"><strong>{t('Taslak metin', 'Draft text')}</strong>{t(
        'Satıcı bilgileri ve hukuki inceleme tamamlanmadı. Sarı işaretli alanlar doldurulup metin onaylanana kadar bu sayfa üzerinden ödeme alınmaz.',
        'The seller details and the legal review are not complete. No payment is taken with this page until the highlighted fields are filled in and the text is approved.')}</div>}
    >
      <section id="pre">
        <h2>{t('A. Ön bilgilendirme formu', 'A. Pre-contract information')}</h2>
        <p>{t('Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, sözleşme kurulmadan önce bilmeniz gerekenleri özetler.',
          'This form summarises what you need to know before the contract is made, as required by Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation.')}</p>
      </section>

      <section id="seller">
        <h2>{t('1. Satıcı', '1. Seller')}</h2>
        <dl className="rd-dl">
          <dt>{t('Unvan', 'Legal name')}</dt><dd>{sellerName}</dd>
          <dt>{t('MERSİS no', 'MERSIS no.')}</dt><dd>{field(s.mersis, 'doldurulacak', 'to be completed')}</dd>
          <dt>{t('Vergi dairesi / no', 'Tax office / no.')}</dt><dd>{field(s.taxOffice, 'vergi dairesi', 'tax office')} / {field(s.taxNumber, 'vergi no', 'tax no.')}</dd>
          <dt>{t('Adres', 'Address')}</dt><dd>{field(s.address, 'açık adres — doldurulacak', 'full address — to be completed')}</dd>
          <dt>{t('Telefon', 'Phone')}</dt><dd>{field(s.phone, 'doldurulacak', 'to be completed')}</dd>
          <dt>{t('E-posta', 'Email')}</dt><dd>{field(s.email, 'doldurulacak', 'to be completed')}</dd>
          {s.kep.trim() && <><dt>KEP</dt><dd>{s.kep}</dd></>}
        </dl>
      </section>

      <section id="service">
        <h2>{t('2. Hizmet', '2. The service')}</h2>
        <p>{t(<>Ryzevo, web tarayıcısından kullanılan bir <strong>çevrimiçi yazılım hizmetidir</strong>. Ürününüzün hedefleri etrafında içerik ve kampanya taslakları, SEO çalışmaları, iş takvimi, ölçümler ve büyüme koçu sunar.</>,
          <>Ryzevo is an <strong>online software service</strong> used in a web browser. Around your product’s goals it provides content and campaign drafts, SEO work, a work calendar, measurements and a growth coach.</>)}</p>
        <ul>
          <li>{t('AI destekli özellikler öneri ve taslak üretir. Satıcı belirli bir trafik, sıralama, etkileşim, müşteri veya satış sonucu taahhüt etmez.',
            'AI-assisted features produce suggestions and drafts. The seller does not promise any traffic, ranking, engagement, customer or sales result.')}</li>
          <li>{t('Hiçbir içerik sizin veya ekibinizin onayı olmadan yayınlanmaz ya da gönderilmez.',
            'No content is published or sent without approval from you or your team.')}</li>
          <li>{t('Google, LinkedIn, Meta, X gibi üçüncü taraf hesapları siz bağlarsınız; bu hizmetler kendi koşullarına tabidir ve ücretleri plana dahil değildir.',
            'You connect third-party accounts such as Google, LinkedIn, Meta and X; those services have their own terms and their fees are not part of the plan.')}</li>
        </ul>
      </section>

      <section id="price">
        <h2>{t('3. Planlar ve fiyatlar', '3. Plans and prices')}</h2>
        <div className="rd-table"><table>
          <thead><tr><th>{t('Plan', 'Plan')}</th><th>{t('Aylık', 'Monthly')}</th><th>{t('Yıllık', 'Yearly')}</th><th>{t('Koltuk', 'Seats')}</th><th>{t('Sosyal hesap', 'Social accounts')}</th><th>{t('AI / ay', 'AI / month')}</th><th>{t('Denetim / ay', 'Audits / month')}</th></tr></thead>
          <tbody>{plans.map(plan => <tr key={plan.id}>
            <td><strong>{plan.name}</strong></td><td className="num">{usd(plan.monthlyUsdMinor)}</td><td className="num">{usd(plan.monthlyUsdMinor * 10)}</td>
            <td className="num">{plan.seats}</td><td className="num">{plan.socialAccounts}</td><td className="num">{plan.ai}</td><td className="num">{plan.audits}</td>
          </tr>)}</tbody>
        </table></div>
        <ul>
          <li>{t('Fiyatlar ABD doları (USD) cinsindendir. Yıllık plan on aylık fiyatına satılır.', 'Prices are in US dollars (USD). A yearly plan costs ten months.')} {vat}</li>
          <li>{t('Sipariş anında gösterilen fiyat o dönem için sabittir; sonraki fiyat değişiklikleri ödenmiş dönemi etkilemez.', 'The price shown when you order is fixed for that period; later price changes do not affect a period already paid for.')}</li>
          <li>{t('Kartınızı veren banka döviz çevirisi veya işlem ücreti uygulayabilir; bu ücretler satıcıya ödenmez.', 'Your card issuer may apply currency conversion or transaction fees; these are not paid to the seller.')}</li>
          <li>{t('Teslimat veya kurulum ücreti yoktur.', 'There is no delivery or set-up fee.')}</li>
        </ul>
      </section>

      <section id="payment">
        <h2>{t('4. Ödeme ve ifa', '4. Payment and performance')}</h2>
        <ul>
          <li>{t('Ödeme, PayTR’ın güvenli ödeme sayfasında kredi veya banka kartıyla, tek çekimle alınır. Taksit yoktur.', 'Payment is taken on PayTR’s secure payment page by credit or debit card, in a single charge. There are no instalments.')}</li>
          <li>{t('Kart bilgileriniz Ryzevo’da saklanmaz. Ad, telefon, adres ve e-posta bilgileriniz yalnızca ödeme için PayTR’a iletilir.', 'Your card details are not stored by Ryzevo. Your name, phone, address and email are sent to PayTR for the payment only.')}</li>
          <li>{t('Otomatik yenileme veya tekrarlayan çekim yoktur. Her dönem ayrı bir ödemedir.', 'There is no automatic renewal or recurring charge. Each period is a separate payment.')}</li>
          <li>{t(<>Hizmet, ödemenin PayTR tarafından onaylanmasıyla satın alma yapılan projede <strong>elektronik ortamda hemen</strong> başlar.</>, <>The service starts <strong>immediately and electronically</strong> in the purchased project once PayTR confirms the payment.</>)}</li>
          <li>{t(<>Faturanız, ödemeden sonra {invoice} içinde hesabınızın doğrulanmış e-posta adresine gönderilir.</>, <>Your invoice is sent to your account’s verified email address within {invoice} of payment.</>)}</li>
        </ul>
      </section>

      <section id="term">
        <h2>{t('5. Süre ve yenileme', '5. Term and renewal')}</h2>
        <ul>
          <li>{t('Aylık plan bir takvim ayı, yıllık plan on iki takvim ayı sürer (UTC). Örneğin 31 Ocak’ta başlayan aylık dönem şubatın son günü biter.', 'A monthly plan lasts one calendar month and a yearly plan twelve calendar months (UTC). For example, a monthly period starting on 31 January ends on the last day of February.')}</li>
          <li>{t('Plan yalnızca satın alındığı projede geçerlidir ve başka projeye aktarılamaz.', 'The plan applies only to the project it was bought for and cannot be moved to another project.')}</li>
          <li>{t('Yeni dönemi, mevcut dönemin bitmesine 14 gün kala satın alabilirsiniz; yeni dönem önceki dönemin bittiği anda başlar.', 'You can buy the next period from 14 days before the current one ends; the new period starts the moment the previous one ends.')}</li>
          <li>{t('Dönem bitince 7 günlük ek süre tanınır. Ek süre sonunda proje plansız duruma döner: yeni iş başlatılamaz, kayıtlarınız silinmez.', 'When a period ends there is a 7-day grace period. After it, the project returns to having no plan: new work cannot be started and your records are not deleted.')}</li>
        </ul>
      </section>

      <section id="withdrawal">
        <h2>{t('6. Cayma hakkı', '6. Right of withdrawal')}</h2>
        <p>{t(<>Mesafeli Sözleşmeler Yönetmeliği’nin 15. maddesinin birinci fıkrasının (ğ) bendi uyarınca, <strong>elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı bulunmaz</strong>. Ödeme formunda, hizmetin ödeme onaylanınca hemen başlamasını ve bu nedenle cayma hakkınızın olmadığını ayrıca onaylarsınız.</>,
          <>Under Article 15(1)(ğ) of the Distance Contracts Regulation, <strong>there is no right of withdrawal for services performed immediately in electronic form</strong>. On the payment form you separately confirm that the service starts as soon as the payment is confirmed and that you therefore have no right of withdrawal.</>)}</p>
        <p>{t('Bu, ayıplı hizmete ilişkin kanuni haklarınızı etkilemez: hizmet sözleşmeye uygun sunulmazsa yeniden ifa, ücret indirimi veya sözleşmeden dönme haklarınız saklıdır. Talebinizi aşağıdaki iletişim bilgilerine iletebilirsiniz.',
          'This does not affect your statutory rights for a defective service: if the service is not provided as agreed, your rights to re-performance, a price reduction or termination remain. You can send your request to the contact details below.')}</p>
      </section>

      <section id="technical">
        <h2>{t('7. Teknik koşullar', '7. Technical requirements')}</h2>
        <ul>
          <li>{t('Güncel bir web tarayıcısı ve internet bağlantısı yeterlidir; kurulum gerekmez.', 'A current web browser and an internet connection are enough; nothing needs installing.')}</li>
          <li>{t('Hesabınız şifreyle korunur; oturum güvenli bir çerezle tutulur. Ekip üyelerinin erişimi rollerine göre sınırlanır.', 'Your account is protected by a password and the session is kept in a secure cookie. Team members’ access is limited by their roles.')}</li>
        </ul>
      </section>

      <section id="complaints">
        <h2>{t('8. Şikâyet ve başvuru', '8. Complaints')}</h2>
        <p>{t(<>Şikâyet ve taleplerinizi {sellerName} adına yukarıdaki e-posta veya telefonla iletebilirsiniz.</>, <>You can send complaints and requests to {sellerName} using the email or phone number above.</>)}</p>
        <p>{t('Uyuşmazlıklarda, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar içinde yerleşim yerinizdeki veya işlemin yapıldığı yerdeki tüketici hakem heyetine, bu sınırları aşan durumlarda tüketici mahkemesine başvurabilirsiniz. Tüketici hakem heyetine e-Devlet üzerinden (TÜBİS) de başvurulabilir.',
          'For disputes you can apply to the consumer arbitration committee where you live or where the transaction took place, within the monetary limits announced each year by the Ministry of Trade, and to the consumer court above those limits. Applications to the consumer arbitration committee can also be made through e-Devlet (TÜBİS).')}</p>
      </section>

      <section id="contract">
        <h2>{t('B. Mesafeli satış sözleşmesi', 'B. Distance sales contract')}</h2>

        <h3>{t('Madde 1 — Taraflar', 'Article 1 — Parties')}</h3>
        <p>{t(<><strong>Satıcı:</strong> ön bilgilendirme formunun 1. bölümünde bilgileri yer alan {sellerName}. <strong>Alıcı:</strong> ödeme formunda adı veya unvanı, adresi ve telefonu yazılı olan ve siparişi Ryzevo hesabından veren kişi veya kuruluş.</>,
          <><strong>Seller:</strong> {sellerName}, whose details are in section 1 of the pre-contract information. <strong>Buyer:</strong> the person or organisation whose name, address and phone are entered on the payment form and who places the order from a Ryzevo account.</>)}</p>

        <h3>{t('Madde 2 — Konu', 'Article 2 — Subject')}</h3>
        <p>{t('Bu sözleşme, alıcının seçtiği Ryzevo planının, seçtiği dönem boyunca ön ödemeli kullanım hakkının sağlanmasına ve tarafların hak ve yükümlülüklerine ilişkindir. Planın adı, dönemi ve fiyatı ödeme sayfasında gösterilir ve sipariş kaydında saklanır.',
          'This contract covers the prepaid right to use the Ryzevo plan the buyer selects for the period the buyer selects, and the parties’ rights and obligations. The plan name, period and price are shown on the payment page and kept in the order record.')}</p>

        <h3>{t('Madde 3 — Hizmet, fiyat ve ödeme', 'Article 3 — Service, price and payment')}</h3>
        <p>{t('Hizmetin nitelikleri, plan limitleri, fiyat, ödeme, ifa, süre ve yenileme koşulları ön bilgilendirme formunun 2–5. bölümlerinde yazıldığı gibidir ve bu sözleşmenin parçasıdır. Plan limitleri hesabınızda Proje ayarları → Plan & kullanım ekranında da gösterilir.',
          'The service features, plan limits, price, payment, performance, term and renewal are as set out in sections 2–5 of the pre-contract information, which form part of this contract. Plan limits are also shown in your account under Project settings → Plan & usage.')}</p>

        <h3>{t('Madde 4 — Cayma hakkı', 'Article 4 — Right of withdrawal')}</h3>
        <p>{t('Ön bilgilendirme formunun 6. bölümü uygulanır.', 'Section 6 of the pre-contract information applies.')}</p>

        <h3>{t('Madde 5 — Alıcının yükümlülükleri', 'Article 5 — Buyer’s obligations')}</h3>
        <ul>
          <li>{t('Hesap bilgilerini korumak ve ekip üyelerine yalnız gereken rolleri vermek.', 'To keep account credentials safe and give team members only the roles they need.')}</li>
          <li>{t('Yayınladığı veya gönderdiği içerikten ve ticari elektronik ileti onayı (İYS dahil), kişisel veriler ve fikri haklar mevzuatına uyumdan sorumlu olmak.', 'To be responsible for the content it publishes or sends and for complying with the rules on commercial electronic messages (including İYS), personal data and intellectual property.')}</li>
          <li>{t('Bağladığı üçüncü taraf hesaplarının koşullarına uymak ve hizmeti hukuka aykırı amaçlarla kullanmamak.', 'To comply with the terms of the third-party accounts it connects and not to use the service for unlawful purposes.')}</li>
        </ul>

        <h3>{t('Madde 6 — Satıcının yükümlülükleri', 'Article 6 — Seller’s obligations')}</h3>
        <ul>
          <li>{t('Hizmeti ödenmiş dönem boyunca sözleşmeye uygun sunmak; planlı bakımları mümkün olduğunca önceden duyurmak.', 'To provide the service as agreed for the paid period and announce planned maintenance in advance where possible.')}</li>
          <li>{t('Proje verilerini yalnızca hizmetin sunulması için işlemek ve korumak; bağlantı izinlerini şifreli saklamak.', 'To process and protect project data only to provide the service and to store connection grants encrypted.')}</li>
          <li>{t('AI önerilerini insan onayı olmadan yayınlamamak veya göndermemek.', 'Not to publish or send AI suggestions without human approval.')}</li>
        </ul>

        <h3>{t('Madde 7 — Sorumluluk', 'Article 7 — Liability')}</h3>
        <p>{t('AI çıktıları öneridir; doğruluğu ve uygunluğu yayından önce alıcı tarafından kontrol edilir. Satıcı, kontrolü dışındaki üçüncü taraf hizmetlerin (sosyal ağlar, arama motorları, e-posta ve ödeme sağlayıcıları) kesinti veya değişikliklerinden sorumlu değildir. Kanunun emredici hükümleri saklıdır.',
          'AI output is a suggestion; the buyer checks its accuracy and suitability before publishing. The seller is not responsible for outages or changes in third-party services outside its control (social networks, search engines, email and payment providers). Mandatory provisions of law are reserved.')}</p>

        <h3>{t('Madde 8 — Kişisel veriler', 'Article 8 — Personal data')}</h3>
        <p>{t(<>Kişisel veriler 6698 sayılı Kişisel Verilerin Korunması Kanunu’na uygun olarak işlenir. Ayrıntılar {privacy} içinde yer alır.</>,
          <>Personal data is processed in line with Turkish Personal Data Protection Law No. 6698. Details are in the {privacy}.</>)}</p>

        <h3>{t('Madde 9 — Uyuşmazlık ve yetki', 'Article 9 — Disputes and jurisdiction')}</h3>
        <p>{t('Alıcı tüketici ise ön bilgilendirme formunun 8. bölümü uygulanır.', 'If the buyer is a consumer, section 8 of the pre-contract information applies.')}</p>
        <p>{t(<>Alıcı planı ticari veya mesleki amaçla satın alan bir tacir ise tüketici mevzuatı uygulanmaz; Türk Borçlar Kanunu ve Türk Ticaret Kanunu hükümleri geçerlidir ve uyuşmazlıklarda {SALES_MERCHANT_COURT.trim() || ph('yetkili mahkeme — hukuk incelemesi', 'competent court — legal review')} mahkemeleri ve icra daireleri yetkilidir.</>,
          <>If the buyer is a business buying the plan for commercial or professional purposes, consumer law does not apply; the Turkish Code of Obligations and Commercial Code govern, and the courts and enforcement offices of {SALES_MERCHANT_COURT.trim() || ph('yetkili mahkeme — hukuk incelemesi', 'competent court — legal review')} have jurisdiction.</>)}</p>

        <h3>{t('Madde 10 — Yürürlük', 'Article 10 — Entry into force')}</h3>
        <p>{t('Alıcı ödeme formundaki onay kutusunu işaretleyip ödemeyi tamamladığında sözleşme elektronik ortamda kurulur. Sipariş, kabul edilen metnin adresiyle birlikte satıcının kayıtlarında saklanır. Bu sayfayı kaydederek kendi kopyanızı tutabilirsiniz.',
          'The contract is made electronically when the buyer ticks the box on the payment form and completes the payment. The order is kept in the seller’s records together with the address of the accepted text. You can save this page to keep your own copy.')}</p>
        <p className="rd-small">{t('Sürüm', 'Version')} {SALES_TERMS_VERSION}</p>
      </section>
    </DocShell>
  );
}
