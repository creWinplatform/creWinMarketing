// WhatsApp template sending for standard projects: client-safe types only; the store lives in whatsapp.ts.
// Only Meta-approved templates, only contacts with their own WhatsApp consent, and only after approval and a server switch.
export const WHATSAPP_LIMITS={contacts:500,addPerRequest:100,batchRecipients:20,sendsPerDay:50,batches:50,param:200} as const;
export type WhatsAppAccountView={connectionId:string;phoneNumberId:string;wabaId:string;displayPhone:string;verifiedName:string;quality:string|null;checkedAt:string};
export type WhatsAppHeaderFormat='NONE'|'TEXT'|'IMAGE'|'VIDEO'|'DOCUMENT';
// headerFormat IMAGE/VIDEO/DOCUMENT needs a public https link per batch; buttonUrl is a URL button whose ending ({{1}}) the batch fills in.
export type WhatsAppTemplateView={name:string;language:string;category:string;body:string;params:number;headerFormat:WhatsAppHeaderFormat;buttonUrl:string|null;fetchedAt:string};
export type WhatsAppBatchExtras={headerLink?:string;buttonParam?:string};
export type WhatsAppContactView={id:string;hint:string;consentEvidence:string;consentAt:string;optedOut:boolean;optOutSource:'team'|'reply'|null;createdAt:string};
export type WhatsAppDelivery='sent'|'delivered'|'read'|'failed';
export const WHATSAPP_STOP_WORDS=['stop','dur','durdur','iptal','abonelikten çık','unsubscribe','stop promotions','çıkış'] as const;
export type WhatsAppMessageState='pending'|'submitting'|'accepted'|'rejected'|'uncertain'|'skipped'|'rehearsed';
export type WhatsAppBatchView={
  id:string;name:string;templateName:string;templateLanguage:string;params:string[];overrides:Record<string,string[]>;extras:WhatsAppBatchExtras;contactIds:string[];digest:string;
  state:'draft'|'approved'|'queued'|'done'|'cancelled';mode:'rehearsal'|'send'|null;approved:boolean;approvedAt:string|null;queuedAt:string|null;
  counts:Partial<Record<WhatsAppMessageState,number>>;delivery:Partial<Record<WhatsAppDelivery,number>>;preview:string|null;revision:number;updatedAt:string;
};
export type WhatsAppSnapshot={
  account:WhatsAppAccountView|null;templates:WhatsAppTemplateView[];contacts:WhatsAppContactView[];batches:WhatsAppBatchView[];
  sendEnabled:boolean;sentToday:number;hook:{callbackPath:string;createdAt:string;lastEventAt:string|null}|null;
  can:{connect:boolean;contacts:boolean;write:boolean;approve:boolean;dispatch:boolean;publish:boolean};
};
