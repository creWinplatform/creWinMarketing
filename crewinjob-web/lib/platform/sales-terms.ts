// Ön bilgilendirme formu ve mesafeli satış sözleşmesi (/legal/sales) için satıcı bilgileri.
// Hukuki inceleme bitip alanlar doldurulana kadar sayfa "taslak" etiketli ve noindex kalır; bu adres
// PLATFORM_BILLING_TERMS_URL olarak verilse bile canlı ödeme açılmaz (paytrLiveReadiness).
export const SALES_TERMS_PATH = '/legal/sales';
export const SALES_TERMS_VERSION = '2026-10-27';

export type SalesSeller = {
  name: string; mersis: string; taxOffice: string; taxNumber: string;
  address: string; phone: string; email: string; kep: string;
};
// Boş alanlar sayfada "doldurulacak" işaretiyle gösterilir. KEP isteğe bağlıdır.
export const SALES_SELLER: SalesSeller = {
  name: '', mersis: '', taxOffice: '', taxNumber: '',
  address: '', phone: '', email: '', kep: '',
};
// Muhasebe teyidi: fiyatlar KDV dahil mi (null = henüz teyit edilmedi) ve faturanın kaç gün içinde gönderileceği.
export const SALES_PRICES_INCLUDE_VAT: boolean | null = null;
export const SALES_INVOICE_DAYS: number | null = null;
// Yetkili mahkeme (alıcı tacir olduğunda), örn. 'İstanbul (Çağlayan)'. Tüketiciler için kanuni yetki kuralları geçerlidir.
export const SALES_MERCHANT_COURT = '';
// Metin bir hukukçu tarafından onaylandığında true yapılır.
export const SALES_TERMS_LEGAL_REVIEWED = false;

export function salesTermsMissing(): string[] {
  const missing: string[] = (['name', 'mersis', 'taxOffice', 'taxNumber', 'address', 'phone', 'email'] as const).filter(key => !SALES_SELLER[key].trim());
  if (SALES_PRICES_INCLUDE_VAT === null) missing.push('vat');
  if (!SALES_INVOICE_DAYS) missing.push('invoiceDays');
  if (!SALES_MERCHANT_COURT.trim()) missing.push('merchantCourt');
  if (!privacyReady()) missing.push('privacy');
  if (!SALES_TERMS_LEGAL_REVIEWED) missing.push('legalReview');
  return missing;
}
export const salesTermsReady = () => salesTermsMissing().length === 0;

// KVKK aydınlatma metni (/legal/privacy). Veri sorumlusu yukarıdaki satıcıdır (aynı şirket bilgileri kullanılır).
// Hukuki inceleme bitip alanlar doldurulana kadar sayfa "taslak" etiketli ve noindex kalır.
export const PRIVACY_PATH = '/legal/privacy';
export const PRIVACY_VERSION = '2026-10-23';
// Sunucunun ve yedeklerin bulunduğu yer, örn. 'AWS Frankfurt (eu-central-1)'. Yurt dışı aktarım bölümünde gösterilir.
export const PRIVACY_HOSTING_LOCATION = '';
// Saklama süreleri (hukuk incelemesi): hesap ve proje kayıtları, denetim kayıtları ve yedekler için.
export const PRIVACY_RETENTION = { account: '', audit: '', backups: '' };
// VERBİS kaydı gerekiyorsa sicil numarası; gerekmiyorsa boş bırakılır ve sayfada gösterilmez.
export const PRIVACY_VERBIS = '';
// Metin bir hukukçu tarafından onaylandığında true yapılır.
export const PRIVACY_LEGAL_REVIEWED = false;

export function privacyMissing(): string[] {
  const missing: string[] = (['name', 'address', 'email'] as const).filter(key => !SALES_SELLER[key].trim());
  if (!PRIVACY_HOSTING_LOCATION.trim()) missing.push('hosting');
  for (const key of ['account', 'audit', 'backups'] as const) if (!PRIVACY_RETENTION[key].trim()) missing.push(`retention.${key}`);
  if (!PRIVACY_LEGAL_REVIEWED) missing.push('legalReview');
  return missing;
}
export const privacyReady = () => privacyMissing().length === 0;
