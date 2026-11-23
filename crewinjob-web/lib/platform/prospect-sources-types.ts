// Sales assistant, advanced sources: a company list the team brings (for example a purchased one), person addresses
// from the team's own Hunter account or guessed from a name on the company's site, and companies that visit the
// project's own website (identified from the network address, only after the visitor consents). Each source is off
// until the project owner accepts its own responsibility text. Pure data shared by the server and the browser.
type Pair = [string, string];
export const SOURCE_LIMITS = { importRows: 200, importsPerDay: 5, hunterPerDay: 20, hunterEmails: 5, guessesPerDay: 40, visitorDays: 30, visitorCompanies: 200, beaconsPerDay: 5000, pagesKept: 5 } as const;
export const SOURCE_TERMS_VERSION = '2026-11-v1';
export type SourceKind = 'list' | 'visitors';
export const SOURCE_TERMS: Record<SourceKind, Pair> = {
  list: [
    'Yüklediğiniz firma ve kişi listesini siz sağlarsınız. Listenin nasıl elde edildiğinden, 6698 sayılı KVKK kapsamındaki hukuki dayanaktan ve aydınlatma yükümlülüğünden, 6563 sayılı Kanun ve İYS kurallarına uygunluktan yalnız projenin sahibi olan işletme sorumludur. Ryzevo listeyi yalnız sizin talimatınızla projenizde saklar ve işler; doğruluğunu garanti etmez. Bireysel e-posta adreslerine (ör. gmail.com) satış e-postası gönderilmez.',
    'You provide the company and person list you upload. The business that owns this project is solely responsible for how the list was obtained, for the legal basis and notice duties under data protection law (KVKK No. 6698), and for complying with law No. 6563 and İYS. Ryzevo only stores and processes the list in your project on your instruction and does not warrant its accuracy. Sales emails never go to personal mailbox addresses (for example gmail.com).',
  ],
  visitors: [
    'Ziyaretçi firma tespiti, sitenize eklediğiniz küçük bir kodla çalışır ve yalnız ziyaretçi çerez/izin ekranınızda onay verdikten sonra veri gönderir. Ziyaretçinin ağ adresi (IP) bir sağlayıcıda (IPinfo) kuruma çevrilir; IP adresi saklanmaz, kişi tespit edilmez, yalnız kurum adı, alan adı ve ziyaret edilen sayfa yolu tutulur. Sitenizin aydınlatma metninde ve izin ekranında bu işleme yer vermek ve izni almak projenin sahibi olan işletmenin sorumluluğundadır.',
    'Visitor company identification works through a small snippet on your site and sends data only after the visitor consents in your cookie/consent banner. The visitor’s network address (IP) is turned into an organisation by a provider (IPinfo); the IP address is not stored and no person is identified: only the organisation name, its domain and the page path are kept. Mentioning this processing in your site’s privacy notice and consent banner and obtaining the consent is the responsibility of the business that owns this project.',
  ],
};
// Personal mailbox providers: a sales email never goes there (a consumer address needs prior consent).
export const PERSONAL_MAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|yandex|icloud|me|mac|aol|gmx|mail|protonmail|proton|windowslive|mynet|superonline|ttmail)\.[a-z.]+$/i;
export type ExtraContact = { id: string; kind: 'email' | 'phone'; value: string; source: 'import' | 'hunter' | 'guess'; person: boolean; confidence: number | null; note: string };
export type VisitorCompany = { key: string; name: string; domain: string; kind: string; visits: number; pages: string[]; firstSeen: string; lastSeen: string; prospectId: string | null };
export type SourcesSnapshot = {
  terms: Record<SourceKind, { by: string; at: string } | null>;
  hunter: { configured: boolean; masked: string | null; usedToday: number };
  imports: { id: string; rows: number; added: number; skipped: number; createdAt: string }[];
  visitors: { enabled: boolean; siteKey: string | null; providerConfigured: boolean; snippet: string | null; companies: VisitorCompany[] };
  canWrite: boolean; canManage: boolean; canAcceptTerms: boolean;
};
