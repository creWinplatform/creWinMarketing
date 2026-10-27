// Ön bilgilendirme formu + mesafeli satış sözleşmesi: tek kaynak. /legal/sales sayfası bunu çizer; ödeme onaylanınca
// aynı metnin düz yazı hâli siparişle saklanır ve alıcıya e-postayla gönderilir (kalıcı veri saklayıcısı).
// Türkçe metin esastır; İngilizce metin bilgi amaçlı çeviridir. Fiyatlar PLAN_CATALOG'dan gelir.
import { AGENCY_PACKAGE, PLAN_CATALOG } from './plan-catalog';
import {
  PRIVACY_PATH, SALES_INVOICE_DAYS, SALES_MERCHANT_COURT, SALES_PRICES_INCLUDE_VAT, SALES_SELLER, SALES_TERMS_VERSION,
} from './sales-terms';

type Lang = 'tr' | 'en';
// Inline parts: plain text, bold, a placeholder still to be completed, or a link.
export type TermsInline = string | { b: string } | { ph: string } | { a: string; href: string };
export type TermsBlock =
  | { p: TermsInline[] }
  | { ul: TermsInline[][] }
  | { dl: [string, TermsInline[]][] }
  | { table: { head: string[]; rows: string[][] } }
  | { h3: string };
export type TermsSection = { id: string; title: string; blocks: TermsBlock[] };
export type TermsDocument = { title: string; lead: string; version: string; sections: TermsSection[] };

const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function salesTermsDocument(lang: Lang): TermsDocument {
  const en = lang === 'en', t = <T,>(tr: T, eng: T): T => (en ? eng : tr);
  const ph = (tr: string, eng: string): TermsInline => ({ ph: t(tr, eng) });
  const field = (value: string, tr: string, eng: string): TermsInline => (value.trim() ? value : ph(tr, eng));
  const s = SALES_SELLER, seller = field(s.name, 'Satıcı unvanı — doldurulacak', 'Seller’s legal name — to be completed');
  const plans = PLAN_CATALOG.filter(plan => plan.availability === 'planned');
  const vat: TermsInline = SALES_PRICES_INCLUDE_VAT === null ? ph('KDV dahil mi, hariç mi — muhasebe teyidi', 'VAT included or excluded — to be confirmed by accounting')
    : SALES_PRICES_INCLUDE_VAT ? t('Fiyatlara KDV dahildir.', 'Prices include VAT.') : t('Fiyatlara KDV eklenir; ödeme sayfasında KDV dahil toplam gösterilir.', 'VAT is added to the prices; the payment page shows the total including VAT.');
  const invoice: TermsInline = SALES_INVOICE_DAYS ? t(`${SALES_INVOICE_DAYS} gün`, `${SALES_INVOICE_DAYS} days`) : ph('fatura süresi — muhasebe teyidi', 'invoice period — to be confirmed by accounting');
  const court: TermsInline = SALES_MERCHANT_COURT.trim() || ph('yetkili mahkeme — hukuk incelemesi', 'competent court — legal review');
  const privacy: TermsInline = { a: t('kişisel verilerin işlenmesine ilişkin aydınlatma metni', 'privacy notice'), href: PRIVACY_PATH };
  const sec = (id: string, title: string, blocks: TermsBlock[]): TermsSection => ({ id, title, blocks });

  return {
    title: t('Ön bilgilendirme formu ve mesafeli satış sözleşmesi', 'Pre-contract information and distance sales contract'),
    lead: t('Ryzevo planını ryzevo.com üzerinden satın alırken bu iki metni onaylarsınız: önce ön bilgilendirme formu, ardından mesafeli satış sözleşmesi. Ödeme formundaki onay kutusunu işaretlemeniz, metinleri okuduğunuzu ve kabul ettiğinizi gösterir.',
      'When you buy a Ryzevo plan on ryzevo.com you accept these two texts: first the pre-contract information, then the distance sales contract. Ticking the box on the payment form confirms that you have read and accepted them.'),
    version: SALES_TERMS_VERSION,
    sections: [
      sec('pre', t('A. Ön bilgilendirme formu', 'A. Pre-contract information'), [
        { p: [t('Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, sözleşme kurulmadan önce bilmeniz gerekenleri özetler.',
          'This form summarises what you need to know before the contract is made, as required by Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation.')] },
      ]),
      sec('seller', t('1. Satıcı', '1. Seller'), [
        { dl: [
          [t('Unvan', 'Legal name'), [seller]],
          [t('MERSİS no', 'MERSIS no.'), [field(s.mersis, 'doldurulacak', 'to be completed')]],
          [t('Vergi dairesi / no', 'Tax office / no.'), [field(s.taxOffice, 'vergi dairesi', 'tax office'), ' / ', field(s.taxNumber, 'vergi no', 'tax no.')]],
          [t('Adres', 'Address'), [field(s.address, 'açık adres — doldurulacak', 'full address — to be completed')]],
          [t('Telefon', 'Phone'), [field(s.phone, 'doldurulacak', 'to be completed')]],
          [t('E-posta', 'Email'), [field(s.email, 'doldurulacak', 'to be completed')]],
          ...(s.kep.trim() ? [['KEP', [s.kep]] as [string, TermsInline[]]] : []),
        ] },
      ]),
      sec('service', t('2. Hizmet', '2. The service'), [
        { p: t<TermsInline[]>(['Ryzevo, web tarayıcısından kullanılan bir ', { b: 'çevrimiçi yazılım hizmetidir' }, '. Ürününüzün hedefleri etrafında içerik ve kampanya taslakları, SEO çalışmaları, iş takvimi, ölçümler ve büyüme koçu sunar.'],
          ['Ryzevo is an ', { b: 'online software service' }, ' used in a web browser. Around your product’s goals it provides content and campaign drafts, SEO work, a work calendar, measurements and a growth coach.']) },
        { ul: [
          [t('AI destekli özellikler öneri ve taslak üretir. Satıcı belirli bir trafik, sıralama, etkileşim, müşteri veya satış sonucu taahhüt etmez.', 'AI-assisted features produce suggestions and drafts. The seller does not promise any traffic, ranking, engagement, customer or sales result.')],
          [t('Hiçbir içerik sizin veya ekibinizin onayı olmadan yayınlanmaz ya da gönderilmez.', 'No content is published or sent without approval from you or your team.')],
          [t('Google, LinkedIn, Meta, X gibi üçüncü taraf hesapları siz bağlarsınız; bu hizmetler kendi koşullarına tabidir ve ücretleri plana dahil değildir.', 'You connect third-party accounts such as Google, LinkedIn, Meta and X; those services have their own terms and their fees are not part of the plan.')],
        ] },
      ]),
      sec('price', t('3. Planlar ve fiyatlar', '3. Plans and prices'), [
        { table: { head: [t('Plan', 'Plan'), t('Aylık', 'Monthly'), t('Yıllık', 'Yearly'), t('Koltuk', 'Seats'), t('Sosyal hesap', 'Social accounts'), t('AI / ay', 'AI / month'), t('Denetim / ay', 'Audits / month')],
          rows: [...plans.map(plan => [plan.name, usd(plan.monthlyUsdMinor), usd(plan.monthlyUsdMinor * 10), String(plan.seats), String(plan.socialAccounts), String(plan.ai), String(plan.audits)]),
            ...plans.filter(plan => plan.id === AGENCY_PACKAGE.plan).map(plan => [t(`${AGENCY_PACKAGE.name} (ajans paketi)`, `${AGENCY_PACKAGE.name} (agency package)`), usd(AGENCY_PACKAGE.monthlyUsdMinor), usd(AGENCY_PACKAGE.monthlyUsdMinor * 10), String(plan.seats), String(plan.socialAccounts), String(plan.ai), String(plan.audits)])] } },
        { ul: [
          [t('Fiyatlar ABD doları (USD) cinsindendir. Yıllık plan on aylık fiyatına satılır.', 'Prices are in US dollars (USD). A yearly plan costs ten months.'), ' ', vat],
          [t(`Ajans paketi, satın alındığı projeyi ve alıcının bağladığı en fazla ${AGENCY_PACKAGE.projects} müşteri projesini kapsar; tablodaki sınırlar her proje için ayrı ayrı geçerlidir. Bir müşteri projesi yalnız o projenin sahibinin onayıyla bağlanır ve proje sahibi onu istediği an paketten çıkarabilir; çıkarılan proje kendi planına döner. Paketten bir projenin çıkması fiyatı değiştirmez.`, `The agency package covers the project it is bought for and up to ${AGENCY_PACKAGE.projects} client projects the buyer links; the limits in the table apply to each project separately. A client project is linked only with its owner’s consent, and that owner can remove it from the package at any time; a removed project returns to its own plan. A project leaving the package does not change the price.`)],
          [t('Sipariş anında gösterilen fiyat o dönem için sabittir; sonraki fiyat değişiklikleri ödenmiş dönemi etkilemez.', 'The price shown when you order is fixed for that period; later price changes do not affect a period already paid for.')],
          [t('Kartınızı veren banka döviz çevirisi veya işlem ücreti uygulayabilir; bu ücretler satıcıya ödenmez.', 'Your card issuer may apply currency conversion or transaction fees; these are not paid to the seller.')],
          [t('Teslimat veya kurulum ücreti yoktur.', 'There is no delivery or set-up fee.')],
        ] },
      ]),
      sec('payment', t('4. Ödeme ve ifa', '4. Payment and performance'), [
        { ul: [
          [t('Ödeme, PayTR’ın güvenli ödeme sayfasında kredi veya banka kartıyla, tek çekimle alınır. Taksit yoktur.', 'Payment is taken on PayTR’s secure payment page by credit or debit card, in a single charge. There are no instalments.')],
          [t('Kart bilgileriniz Ryzevo’da saklanmaz. Ad, telefon, adres ve e-posta bilgileriniz yalnızca ödeme için PayTR’a iletilir.', 'Your card details are not stored by Ryzevo. Your name, phone, address and email are sent to PayTR for the payment only.')],
          [t('Otomatik yenileme veya tekrarlayan çekim yoktur. Her dönem ayrı bir ödemedir.', 'There is no automatic renewal or recurring charge. Each period is a separate payment.')],
          t<TermsInline[]>(['Hizmet, ödemenin PayTR tarafından onaylanmasıyla satın alma yapılan projede ', { b: 'elektronik ortamda hemen' }, ' başlar.'], ['The service starts ', { b: 'immediately and electronically' }, ' in the purchased project once PayTR confirms the payment.']),
          t<TermsInline[]>(['Faturanız, ödemeden sonra ', invoice, ' içinde hesabınızın doğrulanmış e-posta adresine gönderilir.'], ['Your invoice is sent to your account’s verified email address within ', invoice, ' of payment.']),
          [t('Bu metnin bir kopyası, ödeme onaylandıktan sonra hesabınızın doğrulanmış e-posta adresine gönderilir.', 'A copy of this text is sent to your account’s verified email address after the payment is confirmed.')],
        ] },
      ]),
      sec('term', t('5. Süre ve yenileme', '5. Term and renewal'), [
        { ul: [
          [t('Aylık plan bir takvim ayı, yıllık plan on iki takvim ayı sürer (UTC). Örneğin 31 Ocak’ta başlayan aylık dönem şubatın son günü biter.', 'A monthly plan lasts one calendar month and a yearly plan twelve calendar months (UTC). For example, a monthly period starting on 31 January ends on the last day of February.')],
          [t('Plan yalnızca satın alındığı projede geçerlidir ve başka projeye aktarılamaz.', 'The plan applies only to the project it was bought for and cannot be moved to another project.')],
          [t('Yeni dönemi, mevcut dönemin bitmesine 14 gün kala satın alabilirsiniz; yeni dönem önceki dönemin bittiği anda başlar.', 'You can buy the next period from 14 days before the current one ends; the new period starts the moment the previous one ends.')],
          [t('Dönem bitince 7 günlük ek süre tanınır. Ek süre sonunda proje plansız duruma döner: yeni iş başlatılamaz, kayıtlarınız silinmez.', 'When a period ends there is a 7-day grace period. After it, the project returns to having no plan: new work cannot be started and your records are not deleted.')],
        ] },
      ]),
      sec('withdrawal', t('6. Cayma hakkı', '6. Right of withdrawal'), [
        { p: t<TermsInline[]>(['Mesafeli Sözleşmeler Yönetmeliği’nin 15. maddesinin birinci fıkrasının (ğ) bendi uyarınca, ', { b: 'elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı bulunmaz' }, '. Ödeme formunda, hizmetin ödeme onaylanınca hemen başlamasını ve bu nedenle cayma hakkınızın olmadığını ayrıca onaylarsınız.'],
          ['Under Article 15(1)(ğ) of the Distance Contracts Regulation, ', { b: 'there is no right of withdrawal for services performed immediately in electronic form' }, '. On the payment form you separately confirm that the service starts as soon as the payment is confirmed and that you therefore have no right of withdrawal.']) },
        { p: [t('Bu, ayıplı hizmete ilişkin kanuni haklarınızı etkilemez: hizmet sözleşmeye uygun sunulmazsa yeniden ifa, ücret indirimi veya sözleşmeden dönme haklarınız saklıdır. Talebinizi aşağıdaki iletişim bilgilerine iletebilirsiniz.',
          'This does not affect your statutory rights for a defective service: if the service is not provided as agreed, your rights to re-performance, a price reduction or termination remain. You can send your request to the contact details below.')] },
      ]),
      sec('technical', t('7. Teknik koşullar', '7. Technical requirements'), [
        { ul: [
          [t('Güncel bir web tarayıcısı ve internet bağlantısı yeterlidir; kurulum gerekmez.', 'A current web browser and an internet connection are enough; nothing needs installing.')],
          [t('Hesabınız şifreyle korunur; oturum güvenli bir çerezle tutulur. Ekip üyelerinin erişimi rollerine göre sınırlanır.', 'Your account is protected by a password and the session is kept in a secure cookie. Team members’ access is limited by their roles.')],
        ] },
      ]),
      sec('complaints', t('8. Şikâyet ve başvuru', '8. Complaints'), [
        { p: t<TermsInline[]>(['Şikâyet ve taleplerinizi ', seller, ' adına yukarıdaki e-posta veya telefonla iletebilirsiniz.'], ['You can send complaints and requests to ', seller, ' using the email or phone number above.']) },
        { p: [t('Uyuşmazlıklarda, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar içinde yerleşim yerinizdeki veya işlemin yapıldığı yerdeki tüketici hakem heyetine, bu sınırları aşan durumlarda tüketici mahkemesine başvurabilirsiniz. Tüketici hakem heyetine e-Devlet üzerinden (TÜBİS) de başvurulabilir.',
          'For disputes you can apply to the consumer arbitration committee where you live or where the transaction took place, within the monetary limits announced each year by the Ministry of Trade, and to the consumer court above those limits. Applications to the consumer arbitration committee can also be made through e-Devlet (TÜBİS).')] },
      ]),
      sec('contract', t('B. Mesafeli satış sözleşmesi', 'B. Distance sales contract'), [
        { h3: t('Madde 1 — Taraflar', 'Article 1 — Parties') },
        { p: t<TermsInline[]>([{ b: 'Satıcı:' }, ' ön bilgilendirme formunun 1. bölümünde bilgileri yer alan ', seller, '. ', { b: 'Alıcı:' }, ' ödeme formunda adı veya unvanı, adresi ve telefonu yazılı olan ve siparişi Ryzevo hesabından veren kişi veya kuruluş.'],
          [{ b: 'Seller:' }, ' ', seller, ', whose details are in section 1 of the pre-contract information. ', { b: 'Buyer:' }, ' the person or organisation whose name, address and phone are entered on the payment form and who places the order from a Ryzevo account.']) },
        { h3: t('Madde 2 — Konu', 'Article 2 — Subject') },
        { p: [t('Bu sözleşme, alıcının seçtiği Ryzevo planının, seçtiği dönem boyunca ön ödemeli kullanım hakkının sağlanmasına ve tarafların hak ve yükümlülüklerine ilişkindir. Planın adı, dönemi ve fiyatı ödeme sayfasında gösterilir ve sipariş kaydında saklanır.',
          'This contract covers the prepaid right to use the Ryzevo plan the buyer selects for the period the buyer selects, and the parties’ rights and obligations. The plan name, period and price are shown on the payment page and kept in the order record.')] },
        { h3: t('Madde 3 — Hizmet, fiyat ve ödeme', 'Article 3 — Service, price and payment') },
        { p: [t('Hizmetin nitelikleri, plan limitleri, fiyat, ödeme, ifa, süre ve yenileme koşulları ön bilgilendirme formunun 2–5. bölümlerinde yazıldığı gibidir ve bu sözleşmenin parçasıdır. Plan limitleri hesabınızda Proje ayarları → Plan & kullanım ekranında da gösterilir.',
          'The service features, plan limits, price, payment, performance, term and renewal are as set out in sections 2–5 of the pre-contract information, which form part of this contract. Plan limits are also shown in your account under Project settings → Plan & usage.')] },
        { h3: t('Madde 4 — Cayma hakkı', 'Article 4 — Right of withdrawal') },
        { p: [t('Ön bilgilendirme formunun 6. bölümü uygulanır.', 'Section 6 of the pre-contract information applies.')] },
        { h3: t('Madde 5 — Alıcının yükümlülükleri', 'Article 5 — Buyer’s obligations') },
        { ul: [
          [t('Hesap bilgilerini korumak ve ekip üyelerine yalnız gereken rolleri vermek.', 'To keep account credentials safe and give team members only the roles they need.')],
          [t('Yayınladığı veya gönderdiği içerikten ve ticari elektronik ileti onayı (İYS dahil), kişisel veriler ve fikri haklar mevzuatına uyumdan sorumlu olmak.', 'To be responsible for the content it publishes or sends and for complying with the rules on commercial electronic messages (including İYS), personal data and intellectual property.')],
          [t('Bağladığı üçüncü taraf hesaplarının koşullarına uymak ve hizmeti hukuka aykırı amaçlarla kullanmamak.', 'To comply with the terms of the third-party accounts it connects and not to use the service for unlawful purposes.')],
        ] },
        { h3: t('Madde 6 — Satıcının yükümlülükleri', 'Article 6 — Seller’s obligations') },
        { ul: [
          [t('Hizmeti ödenmiş dönem boyunca sözleşmeye uygun sunmak; planlı bakımları mümkün olduğunca önceden duyurmak.', 'To provide the service as agreed for the paid period and announce planned maintenance in advance where possible.')],
          [t('Proje verilerini yalnızca hizmetin sunulması için işlemek ve korumak; bağlantı izinlerini şifreli saklamak.', 'To process and protect project data only to provide the service and to store connection grants encrypted.')],
          [t('AI önerilerini insan onayı olmadan yayınlamamak veya göndermemek.', 'Not to publish or send AI suggestions without human approval.')],
        ] },
        { h3: t('Madde 7 — Sorumluluk', 'Article 7 — Liability') },
        { p: [t('AI çıktıları öneridir; doğruluğu ve uygunluğu yayından önce alıcı tarafından kontrol edilir. Satıcı, kontrolü dışındaki üçüncü taraf hizmetlerin (sosyal ağlar, arama motorları, e-posta ve ödeme sağlayıcıları) kesinti veya değişikliklerinden sorumlu değildir. Kanunun emredici hükümleri saklıdır.',
          'AI output is a suggestion; the buyer checks its accuracy and suitability before publishing. The seller is not responsible for outages or changes in third-party services outside its control (social networks, search engines, email and payment providers). Mandatory provisions of law are reserved.')] },
        { h3: t('Madde 8 — Kişisel veriler', 'Article 8 — Personal data') },
        { p: t<TermsInline[]>(['Kişisel veriler 6698 sayılı Kişisel Verilerin Korunması Kanunu’na uygun olarak işlenir. Ayrıntılar ', privacy, ' içinde yer alır.'], ['Personal data is processed in line with Turkish Personal Data Protection Law No. 6698. Details are in the ', privacy, '.']) },
        { h3: t('Madde 9 — Uyuşmazlık ve yetki', 'Article 9 — Disputes and jurisdiction') },
        { p: [t('Alıcı tüketici ise ön bilgilendirme formunun 8. bölümü uygulanır.', 'If the buyer is a consumer, section 8 of the pre-contract information applies.')] },
        { p: t<TermsInline[]>(['Alıcı planı ticari veya mesleki amaçla satın alan bir tacir ise tüketici mevzuatı uygulanmaz; Türk Borçlar Kanunu ve Türk Ticaret Kanunu hükümleri geçerlidir ve uyuşmazlıklarda ', court, ' mahkemeleri ve icra daireleri yetkilidir.'],
          ['If the buyer is a business buying the plan for commercial or professional purposes, consumer law does not apply; the Turkish Code of Obligations and Commercial Code govern, and the courts and enforcement offices of ', court, ' have jurisdiction.']) },
        { h3: t('Madde 10 — Yürürlük', 'Article 10 — Entry into force') },
        { p: [t('Alıcı ödeme formundaki onay kutusunu işaretleyip ödemeyi tamamladığında sözleşme elektronik ortamda kurulur. Kabul edilen metin siparişle birlikte satıcının kayıtlarında saklanır ve bir kopyası alıcının doğrulanmış e-posta adresine gönderilir.',
          'The contract is made electronically when the buyer ticks the box on the payment form and completes the payment. The accepted text is kept with the order in the seller’s records and a copy is sent to the buyer’s verified email address.')] },
      ]),
    ],
  };
}

// Plain-text rendering for the order snapshot and the email. Links keep their address; placeholders keep brackets.
export function salesTermsPlainText(lang: Lang, origin = '') {
  const doc = salesTermsDocument(lang), out: string[] = [], upper = (value: string) => value.toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-US');
  const inline = (parts: TermsInline[]) => parts.map(part => typeof part === 'string' ? part : 'b' in part ? part.b : 'ph' in part ? `[${part.ph}]` : `${part.a} (${origin}${part.href})`).join('');
  out.push(upper(doc.title), `${lang === 'en' ? 'Version' : 'Sürüm'} ${doc.version}`, '', doc.lead);
  for (const section of doc.sections) {
    out.push('', upper(section.title));
    for (const block of section.blocks) {
      if ('p' in block) out.push(inline(block.p));
      else if ('h3' in block) out.push('', block.h3);
      else if ('ul' in block) for (const item of block.ul) out.push(`- ${inline(item)}`);
      else if ('dl' in block) for (const [term, value] of block.dl) out.push(`${term}: ${inline(value)}`);
      else out.push(block.table.head.join(' | '), ...block.table.rows.map(row => row.join(' | ')));
    }
  }
  return out.join('\n');
}
