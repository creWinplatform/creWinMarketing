// Social inbox for standard projects: client-safe types only; the store lives in social-inbox.ts.
// Comments on the project's own posts and Page/Instagram messages. Reading, drafting a reply and sending it are separate duties.
export const INBOX_LIMITS={syncsPerDay:50,postsPerSync:20,xPostsPerSync:5,autoReadMinutes:30,hookEntries:50,conversationsPerSync:25,reply:1000,messageWindowHours:24,retentionDays:90} as const;
export type InboxItemView={
  id:string;connectionId:string;accountName:string;platform:'facebook'|'instagram'|'linkedin'|'twitter';kind:'comment'|'message';
  text:string;receivedAt:string;postTitle:string|null;postUrl:string|null;state:'new'|'replied'|'dismissed';
  reply:string;replyState:'draft'|'sending'|'sent'|'rejected'|'uncertain'|null;repliedAt:string|null;windowOpen:boolean;revision:number;
};
export type InboxSnapshot={
  accounts:{id:string;name:string;platform:string;personal:boolean;comments:boolean;messages:boolean;lastSyncAt:string|null;autoRead:boolean;autoReadAllowed:boolean;live:boolean;liveEventAt:string|null}[];
  items:InboxItemView[];counts:Record<'new'|'replied'|'dismissed',number>;syncsLeft:number;sendEnabled:boolean;aiConfigured:boolean;liveConfigured:boolean;
  me:{read:boolean;suggest:boolean;publish:boolean;manage:boolean};
};
