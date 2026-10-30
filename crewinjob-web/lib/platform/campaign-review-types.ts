import type {EmailEligibility} from './email-recipient-types';
import type {PilotRecipientCounts,SenderReadiness} from './email-sender-types';
export type ReviewDecision='approved'|'rejected'|'revoked';
export type ReviewState=ReviewDecision|'none'|'outdated'|'authority_lost';
export type ReviewCheck={code:string;state:'pass'|'blocked'|'pending'};
export type CampaignReviewData={
  campaignId:string;name:string;digest:string;timezone:string;language:'tr'|'en';
  canCheck:boolean;canApprove:boolean;approval:ReviewState;
  checks:ReviewCheck[];html:string;subject:string;text:string;ctaUrl:string;
  audience:{matched:number;unknown:number;total:number;computedAt:string;fresh:boolean}|null;
  audienceError:string|null;
  history:{id:number;decision:ReviewDecision;note:string;createdAt:string;byYou:boolean}[];
  sendingEnabled:false;eligibleRecipients:number|null;eligibility:EmailEligibility|null;pilot:PilotRecipientCounts|null;sender:Pick<SenderReadiness,'domain'|'maskedSender'|'ownership'|'maxRecipients'>;
};
export const REVIEW_CHECK_LABELS:Record<string,[string,string]>={
  saved_draft:['Kaydedilmiş taslak','Saved draft'],email_only:['Yalnız e-posta kanalı','Email-only channel'],
  subject:['Geçerli e-posta konusu','Valid email subject'],content:['Dolu ve sınırlı mesaj','Non-empty bounded message'],
  target:['Güvenli HTTPS hedefi','Safe HTTPS target'],variables:['Çözümlenmemiş değişken yok','No unresolved variables'],
  segment:['Sabit kitle sürümü','Pinned audience version'],audience:['Güncel ve eşleşen kitle','Fresh matching audience'],
  approval:['Geçerli içerik onayı','Current content approval'],smtp:['Seçili gönderenin SMTP erişimi','Selected sender SMTP access'],
  sender_domain:['Gönderen alan adı sahipliği','Sender domain ownership'],sender_auth:['SES kimliği ve DKIM','SES identity and DKIM'],pilot:['Proje pilot listesi ve alıcı sınırı','Project pilot allowlist and recipient cap'],
  consent:['Alıcı eşleştirmesi, izin ve suppression','Recipient mapping, consent and suppression'],iys:['İYS beyanı ve bağlantısı','IYS declaration and connection'],
  unsubscribe:['Projeye bağlı abonelikten çıkma','Project-bound unsubscribe'],
  dispatch:['Kontrollü gönderim worker akışı','Controlled dispatch worker'],
};
export const REVIEW_STATE_LABELS:Record<ReviewState,[string,string]>={
  none:['İnceleme bekliyor','Awaiting review'],approved:['İçerik onaylı','Content approved'],
  rejected:['Değişiklik istendi','Changes requested'],revoked:['Onay geri çekildi','Approval withdrawn'],
  outdated:['Taslak değişti; yeniden inceleyin','Draft changed; review again'],authority_lost:['Onaylayan kişinin yetkisi değişti','Approver authority changed'],
};
export const REVIEW_CHECK_HINTS:Record<string,[string,string]>={
  saved_draft:['Taslağı yeniden kaydedin.','Save the draft again.'],email_only:['Bu onay akışı için yalnız e-posta kanalını seçin.','Select only email for this review flow.'],
  subject:['1-200 karakterlik tek satır konu girin.','Enter a single-line subject of 1-200 characters.'],
  content:['Mesaj 1-20.000 karakterlik düz metin olmalı.','Use plain text between 1 and 20,000 characters.'],
  target:['Kimlik bilgisi içermeyen bir HTTPS hedefi girin.','Enter an HTTPS target without embedded credentials.'],
  variables:['Bu önizlemede {{değişken}} alanlarını nihai metinle değiştirin.','Replace {{variables}} with final text for this preview.'],
  segment:['Taslağa kayıtlı bir kitle sürümü bağlayın.','Bind a saved audience version to the draft.'],
  consent:['Alıcılar ve izinler bölümünde alan eşleştirmesini ve izin kanıtlarını tamamlayıp ön kontrolü yenileyin.','Complete email mapping and consent evidence in Recipients & consent, then rerun preflight.'],
  unsubscribe:['Güvenli genel bağlantılar için sunucuda PLATFORM_PUBLIC_ORIGIN HTTPS adresi tanımlanmalı.','Configure a trusted HTTPS PLATFORM_PUBLIC_ORIGIN on the server for public links.'],
  smtp:['Gönderen ve pilot bölümünden SMTP bağlantısını seçin, ardından Bağlantılar alanında erişimini test edin.','Select a sender in Sender & pilot, then test SMTP access in Connections.'],
  sender_domain:['Gönderen ve pilot bölümündeki TXT kaydını DNS alanınıza ekleyip kontrol edin.','Publish the TXT record from Sender & pilot in your DNS, then check it.'],
  sender_auth:['Gönderen ve pilot bölümündeki SES kimlik kontrolünü tamamlayın. Alıcı tarafındaki SPF/DKIM sonucu ayrıca doğrulanır.','Complete the SES identity check in Sender & pilot. Receiver-side SPF/DKIM results require separate verification.'],
  iys:['Proje ayarları → Gönderim izinleri (İYS) bölümünde Türkiye’deki alıcılara ticari ileti gönderip göndermediğinizi beyan edin; gönderiyorsanız İYS’yi bağlayın. Gönderimde her alıcının İYS onayı ayrıca kontrol edilir.','In Project settings → Sending consents (IYS), state whether you send commercial messages to recipients in Turkey; if you do, connect IYS. Each recipient’s IYS consent is checked again when sending.'],
  pilot:['İzinli alıcıların test adreslerini proje pilot listesine ekleyip ön kontrolü yenileyin.','Add consented test recipients to the project pilot allowlist, then rerun preflight.'],
};
