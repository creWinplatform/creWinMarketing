// Managed sales service: the customer sets up nothing technical. Ryzevo assigns a sending domain that belongs to this
// customer only, the company's authorised person approves who the emails are sent on behalf of, Ryzevo sends through a
// provider that accepts this use (swappable behind lib/platform/sending-providers.ts), sees the replies, stops the
// follow-ups when someone answers, and charges prepaid sending credits. Pilot only: up to ten verified companies,
// opened by the operator. Pure data shared by the server and the browser.
type Pair = [string, string];

export const MANAGED_LIMITS = { pilots: 10, dailyCap: 50, inboundDays: 30, inboundChars: 8000, grantMax: 20000, domainsPerProject: 1 } as const;
export const MANAGED_TERMS_VERSION = '2026-11-v1';
// What the company's authorised person approves before the first email.
export const MANAGED_AUTHORITY: Pair = [
  'Şirketimiz adına bu alan adından satış e-postası gönderilmesine yetki veriyorum. E-postalarda gönderen olarak şirketimizin adı görünür; hedef firmaları, metinleri ve her gönderimi ekibimiz onaylar. Yanıtlar Ryzevo üzerinden bize iletilir ve 30 gün saklanır. Alıcıların hukuki durumu (6563, İYS, KVKK) ve gönderimin içeriği şirketimizin sorumluluğundadır; Ryzevo sorun gördüğünde gönderimi durdurabilir.',
  'I authorise sales emails from this domain on behalf of our company. Our company name is shown as the sender; our team approves the target companies, the texts and every sending. Replies are passed to us through Ryzevo and kept for 30 days. The recipients’ legal position (Turkish law No. 6563, İYS, data protection law) and the content are our company’s responsibility; Ryzevo may stop sending when it sees a problem.',
];

export type ManagedStageKey = 'prepare' | 'sender' | 'sending' | 'capacity';
export const MANAGED_STAGES: Record<ManagedStageKey, { label: Pair; detail: Pair }> = {
  prepare: { label: ['Hedef müşteriler ve mesajlar hazırlanıyor', 'Target customers and messages are being prepared'], detail: ['Müşteri gruplarını seçin, firmaları onaylayın ve e-posta taslaklarını okuyun.', 'Choose customer groups, approve companies and read the email drafts.'] },
  sender: { label: ['Gönderici kurulumu tamamlanıyor', 'The sender is being set up'], detail: ['Ryzevo size özel bir alan adı ayırır; şirketiniz adına gönderim yetkisini siz onaylarsınız.', 'Ryzevo sets aside a domain only for you; you approve sending on behalf of your company.'] },
  sending: { label: ['Kontrollü gönderim başladı', 'Controlled sending has started'], detail: ['İlk e-postalar günde 10 ile başlar, mesai saatlerinde gider.', 'The first emails start at 10 a day and go in business hours.'] },
  capacity: { label: ['Sonuçlara göre günlük kapasite artırılıyor', 'Daily capacity grows with the results'], detail: ['Temiz geçen her gönderim günü kapasiteyi artırır; şikâyet veya geri dönme olursa kapasite tutulur ya da gönderim durur.', 'Every clean sending day raises capacity; a spam report or bounces hold it or stop sending.'] },
};
export type ManagedStage = { key: ManagedStageKey; state: 'done' | 'current' | 'todo'; note: string };

export type ManagedDomainView = { id: string; domain: string; fromAddress: string; fromName: string; companyName: string; verified: boolean; approvedAt: string | null; renewsOn: string | null; registrant: 'customer' | 'ryzevo' };
export type InboundView = { id: string; prospectId: string; from: string; matched: 'address' | 'domain' | 'other'; kind: string | null; subject: string; text: string; receivedAt: string };
export type ManagedSnapshot = {
  pilot: { state: 'active' | 'suspended'; companyName: string; dailyCap: number; suspendedReason: string } | null;
  switchOn: boolean; providerConfigured: boolean;
  domain: ManagedDomainView | null; ready: boolean; waiting: null | 'not_pilot' | 'suspended' | 'switch_off' | 'no_provider' | 'no_domain' | 'not_verified' | 'not_approved' | 'no_credits';
  credits: { balance: number; usedThisMonth: number; priceUsd: number | null; followUpsCharged: boolean };
  results: { sent: number; replies: number; interested: number; costPerInterestedUsd: number | null };
  stages: ManagedStage[]; inbound: InboundView[];
  terms: { version: string; text: Pair }; canApprove: boolean; canRead: boolean;
};
export const MANAGED_WAIT: Record<NonNullable<ManagedSnapshot['waiting']>, Pair> = {
  not_pilot: ['Yönetimli gönderim pilot aşamasında; yalnız doğrulanmış pilot şirketlerde açılır.', 'Managed sending is in a pilot; it is open only for verified pilot companies.'],
  suspended: ['Yönetimli gönderim bu proje için durduruldu.', 'Managed sending is stopped for this project.'],
  switch_off: ['Yönetimli gönderim bu sunucuda kapalı.', 'Managed sending is off on this server.'],
  no_provider: ['Gönderim sağlayıcısı henüz yapılandırılmadı.', 'No sending provider is configured yet.'],
  no_domain: ['Ryzevo size özel bir alan adı ayırıyor.', 'Ryzevo is setting aside a domain for you.'],
  not_verified: ['Alan adının gönderici kontrolleri tamamlanıyor.', 'The domain’s sender checks are being completed.'],
  not_approved: ['Şirketiniz adına gönderim yetkisini onaylayın.', 'Approve sending on behalf of your company.'],
  no_credits: ['Gönderim krediniz bitti.', 'Your sending credits are used up.'],
};

// Operator console.
export type OperatorPilotRow = {
  organizationId: string; projectId: string; projectName: string; organizationName: string; state: 'active' | 'suspended'; companyName: string; dailyCap: number; note: string;
  suspendedReason: string; verifiedAt: string; balance: number; domain: string | null; domainApproved: boolean; sent: number; complaints: number; bounces: number;
};
export type OperatorDomainRow = { id: string; domain: string; state: 'available' | 'assigned' | 'released'; projectId: string | null; projectName: string | null; registrant: 'customer' | 'ryzevo'; renewsOn: string | null; fromLocal: string; fromName: string; verified: boolean; checkedAt: string | null; approvedAt: string | null; note: string };
export type ManagedOperatorSnapshot = {
  pilots: OperatorPilotRow[]; domains: OperatorDomainRow[]; projects: { organizationId: string; projectId: string; name: string; organization: string }[];
  switchOn: boolean; provider: string | null; inboundConfigured: boolean; maxPilots: number;
};
