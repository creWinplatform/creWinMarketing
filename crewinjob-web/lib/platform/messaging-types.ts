// Messaging sources for standard projects: client-safe types only; the store lives in messaging-sources.ts.
// Reading sources, suggesting content and publishing are separate duties a person is given on purpose.
export const MESSAGING_DUTIES=['source.read','suggest','publish'] as const;
export type MessagingDuty=typeof MESSAGING_DUTIES[number];
export const MESSAGING_LIMITS={sources:10,topics:20,termsPerTopic:30,readsPerDay:100,retentionDays:90,suggestion:1000} as const;
export type MessagingTopic={id:string;label:string;terms:string[]};
export type MessagingSourceView={id:string;connectionId:string;botName:string;chatId:string;title:string;username:string|null;autoRead:boolean;lastReadAt:string|null;lastError:string|null;revision:number};
export type MessagingPostView={
  id:string;sourceId:string;sourceTitle:string;link:string|null;postedAt:string;text:string;topics:string[];
  state:'new'|'suggested'|'dismissed';suggestion:string;contentId:string|null;decidedAt:string|null;revision:number;
};
export type MessagingMemberView={userId:string;name:string;role:string;implicit:boolean;duties:MessagingDuty[];eligible:Record<MessagingDuty,boolean>};
export type MessagingSnapshot={
  sources:MessagingSourceView[];bots:{id:string;name:string;channel:string}[];posts:MessagingPostView[];counts:Record<'new'|'suggested'|'dismissed',number>;
  dictionary:MessagingTopic[];dictionaryRevision:number;readsLeft:number;
  me:Record<MessagingDuty,boolean>;canManage:boolean;canConnect:boolean;aiConfigured:boolean;members:MessagingMemberView[]|null;
};
