// Sales assistant (B2B prospects, part 2): finding companies, reading signals from their own site, a score, published
// company contact addresses and a shareable mini analysis. Pure data shared by the server and the browser.
export const FINDER_LIMITS = { searchesPerDay: 10, perSearch: 30, reportDays: 60, phones: 3, emails: 5 } as const;

export type SignalKey = 'https' | 'mobile' | 'online_booking' | 'whatsapp' | 'meta_pixel' | 'google_tag' | 'contact_form' | 'ecommerce' | 'blog' | 'meta_description' | 'social' | 'fresh';
type Pair = [string, string];
// label: the signal; yes/no: how the mini analysis words it when the site shows it or not (neutral, never a judgement).
export const SIGNALS: Record<SignalKey, { label: Pair; yes: Pair; no: Pair }> = {
  https: { label: ['Güvenli bağlantı (https)', 'Secure connection (https)'], yes: ['Site güvenli bağlantıyla (https) açılıyor.', 'The site opens over a secure connection (https).'], no: ['Site güvenli bağlantıyla (https) açılmıyor.', 'The site does not open over a secure connection (https).'] },
  mobile: { label: ['Mobil uyum etiketi', 'Mobile viewport tag'], yes: ['Sayfada mobil görünüm etiketi var.', 'The page has a mobile viewport tag.'], no: ['Sayfada mobil görünüm etiketi görmedik; telefonda küçük görünebilir.', 'We did not see a mobile viewport tag; the page may look small on phones.'] },
  online_booking: { label: ['Online randevu / rezervasyon', 'Online booking'], yes: ['Ana sayfada online randevu veya rezervasyon yolu var.', 'The home page offers online booking.'], no: ['Ana sayfada online randevu veya rezervasyon yolu görmedik.', 'We did not see a way to book online on the home page.'] },
  whatsapp: { label: ['WhatsApp butonu', 'WhatsApp button'], yes: ['Sitede WhatsApp ile yazma bağlantısı var.', 'The site has a WhatsApp chat link.'], no: ['Sitede WhatsApp ile yazma bağlantısı görmedik.', 'We did not see a WhatsApp chat link.'] },
  meta_pixel: { label: ['Meta (Facebook) pikseli', 'Meta (Facebook) pixel'], yes: ['Meta reklam ölçümü (piksel) kurulu.', 'Meta ad measurement (pixel) is installed.'], no: ['Meta reklam ölçümü (piksel) görmedik; reklam sonuçları ölçülemeyebilir.', 'We did not see Meta ad measurement (pixel); ad results may not be measured.'] },
  google_tag: { label: ['Google Analytics / Etiket Yöneticisi', 'Google Analytics / Tag Manager'], yes: ['Google ölçüm etiketi kurulu.', 'A Google measurement tag is installed.'], no: ['Google Analytics veya Etiket Yöneticisi görmedik; ziyaretçiler ölçülmüyor olabilir.', 'We did not see Google Analytics or Tag Manager; visits may not be measured.'] },
  contact_form: { label: ['İletişim formu', 'Contact form'], yes: ['Ana sayfada iletişim formu var.', 'The home page has a contact form.'], no: ['Ana sayfada iletişim formu görmedik.', 'We did not see a contact form on the home page.'] },
  ecommerce: { label: ['Online satış (e-ticaret)', 'Online sales (e-commerce)'], yes: ['Sitede online satış altyapısı var.', 'The site sells online.'], no: ['Sitede online satış altyapısı görmedik.', 'We did not see online sales on the site.'] },
  blog: { label: ['Blog / haber bölümü', 'Blog / news section'], yes: ['Sitede blog veya haber bölümü var.', 'The site has a blog or news section.'], no: ['Sitede blog veya haber bölümü görmedik; aramalarda görünürlük sınırlı kalabilir.', 'We did not see a blog or news section; search visibility may stay limited.'] },
  meta_description: { label: ['Arama sonucu açıklaması', 'Search result description'], yes: ['Sayfanın arama sonucu açıklaması yazılmış.', 'The page has a search result description.'], no: ['Sayfanın arama sonucu açıklaması eksik veya çok kısa.', 'The page’s search result description is missing or very short.'] },
  social: { label: ['Sosyal medya bağlantıları', 'Social media links'], yes: ['Sitede sosyal medya hesaplarına bağlantı var.', 'The site links to social media accounts.'], no: ['Sitede sosyal medya hesaplarına bağlantı görmedik.', 'We did not see links to social media accounts.'] },
  fresh: { label: ['Güncel görünen site', 'Recently updated site'], yes: ['Sitenin telif yılı güncel.', 'The site’s copyright year is current.'], no: ['Sitenin telif yılı eski; site bir süredir güncellenmemiş olabilir.', 'The site’s copyright year is old; it may not have been updated for a while.'] },
};
export const SIGNAL_KEYS = Object.keys(SIGNALS) as SignalKey[];
export type Signal = { key: SignalKey; present: boolean | null; evidence: string };
// What the team sells decides which signals mean an opportunity: a missing booking link for a booking product, an
// existing pixel for ad management, and so on.
export type SignalWish = 'missing' | 'present';
export type FinderSettings = { signals: Partial<Record<SignalKey, SignalWish>> };

// Sector suggestions (free text is allowed for Google Maps); OpenStreetMap needs its own tags.
export const FINDER_SECTORS: { id: string; tr: string; en: string; osm: [string, string][] }[] = [
  { id: 'dentist', tr: 'Diş kliniği', en: 'Dental clinic', osm: [['amenity', 'dentist']] },
  { id: 'clinic', tr: 'Klinik / doktor', en: 'Clinic / doctor', osm: [['amenity', 'clinic'], ['amenity', 'doctors']] },
  { id: 'beauty', tr: 'Güzellik salonu', en: 'Beauty salon', osm: [['shop', 'beauty']] },
  { id: 'hairdresser', tr: 'Kuaför', en: 'Hairdresser', osm: [['shop', 'hairdresser']] },
  { id: 'restaurant', tr: 'Restoran', en: 'Restaurant', osm: [['amenity', 'restaurant']] },
  { id: 'cafe', tr: 'Kafe', en: 'Café', osm: [['amenity', 'cafe']] },
  { id: 'hotel', tr: 'Otel', en: 'Hotel', osm: [['tourism', 'hotel']] },
  { id: 'gym', tr: 'Spor salonu', en: 'Gym', osm: [['leisure', 'fitness_centre']] },
  { id: 'estate', tr: 'Emlak ofisi', en: 'Estate agent', osm: [['office', 'estate_agent']] },
  { id: 'lawyer', tr: 'Avukatlık bürosu', en: 'Law firm', osm: [['office', 'lawyer']] },
  { id: 'accountant', tr: 'Mali müşavir / muhasebe', en: 'Accountant', osm: [['office', 'accountant']] },
  { id: 'vet', tr: 'Veteriner', en: 'Veterinarian', osm: [['amenity', 'veterinary']] },
  { id: 'car_repair', tr: 'Oto servis', en: 'Car repair', osm: [['shop', 'car_repair']] },
  { id: 'furniture', tr: 'Mobilya mağazası', en: 'Furniture store', osm: [['shop', 'furniture']] },
  { id: 'clothes', tr: 'Giyim mağazası', en: 'Clothing store', osm: [['shop', 'clothes']] },
  { id: 'school', tr: 'Kurs / dil okulu', en: 'Course / language school', osm: [['amenity', 'language_school'], ['amenity', 'driving_school']] },
  { id: 'it', tr: 'Yazılım / bilişim firması', en: 'IT company', osm: [['office', 'it']] },
  { id: 'insurance', tr: 'Sigorta acentesi', en: 'Insurance agency', osm: [['office', 'insurance']] },
  { id: 'architect', tr: 'Mimarlık ofisi', en: 'Architect', osm: [['office', 'architect']] },
  { id: 'photographer', tr: 'Fotoğraf stüdyosu', en: 'Photo studio', osm: [['craft', 'photographer'], ['shop', 'photo']] },
];

// Google Maps listings come from DataForSEO; the project owner accepts this text once before the first search.
export const FINDER_TERMS_VERSION = '2026-11-v1';
export const FINDER_TERMS: Pair = [
  'Google Haritalar sonuçları, bu veriyi toplayan ve sağlayan bağımsız bir veri sağlayıcıdan (DataForSEO) alınır. Bu sonuçlarla hangi firmalara, hangi kanaldan ve ne zaman ulaşılacağına siz karar verirsiniz. Verinin kullanılmasından ve 6698 sayılı KVKK, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun (İYS dahil) ile ilgili platform kurallarına uygunluktan yalnız projenin sahibi olan işletme sorumludur. Ryzevo verinin doğruluğunu ve güncelliğini garanti etmez; yalnız sizin talimatınızla aramayı yapar ve sonuçları projenizde saklar.',
  'Google Maps results come from an independent data provider (DataForSEO) that collects and supplies this data. You decide which companies to contact, through which channel and when. The business that owns this project is solely responsible for how the data is used and for complying with data protection law (KVKK No. 6698), the e-commerce law No. 6563 (including İYS) and the rules of the platforms concerned. Ryzevo does not warrant the accuracy or freshness of the data; it only runs the search on your instruction and keeps the results in your project.',
];

export type ProspectContact = { id: string; kind: 'email' | 'phone'; value: string; source: 'site' | 'osm' | 'maps'; sourceUrl: string | null };
export type ProspectScore = { total: number; fit: number; signals: number; reach: number; signalsCounted: boolean };
export type ProspectInsight = {
  source: 'manual' | 'osm' | 'maps'; city: string; address: string; category: string; rating: number | null; reviews: number | null;
  signals: Signal[] | null; scannedAt: string | null; score: ProspectScore; contacts: ProspectContact[];
  report: { active: boolean; views: number; lastViewedAt: string | null; expiresAt: string; createdAt: string } | null;
};
export type FinderSearch = { id: string; source: 'osm' | 'maps'; city: string; sector: string; found: number; added: number; withoutWebsite: number; status: 'done' | 'failed'; createdAt: string };
// Paid Google Maps requests: per project by plan, per person across projects, and a platform-wide ceiling; a repeated
// search within 30 days is answered from the shared cache at no cost.
export const MAPS_QUOTA = { paid: { day: 10, month: 100 }, trial: { day: 2, month: 5 }, perUserDay: 10, platformDay: 300, platformMonth: 3000, cacheDays: 30 } as const;
export type MapsQuota = { usedToday: number; usedMonth: number; dayLimit: number; monthLimit: number; blocked: null | 'inactive' | 'project' | 'user' | 'platform' };
export type FinderSnapshot = {
  insights: Record<string, ProspectInsight>; settings: FinderSettings; searchesLeft: number; searches: FinderSearch[]; maps: MapsQuota;
  mapsConfigured: boolean; termsAccepted: { by: string; at: string } | null; canWrite: boolean; canApprove: boolean; canAcceptTerms: boolean;
};
// The public mini analysis (no session): a frozen copy made when the link was created.
export type ProspectAnalysis = {
  language: 'tr' | 'en'; company: string; website: string; scannedAt: string; expiresAt: string;
  findings: { key: SignalKey; present: boolean; text: string }[];
  sender: { name: string; website: string; tagline: string; primary: string; accent: string; logo: string | null };
};
