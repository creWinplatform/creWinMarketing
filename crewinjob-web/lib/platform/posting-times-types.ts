// Client-safe types for the posting time suggestion (posting-times.ts).
export const POSTING_SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;
export type PostingSlot = typeof POSTING_SLOTS[number];
// best: the slot whose median interactions beat the channel's overall median (null when none does or there is too little data).
export type PostingTimesChannel = { platform: string; posts: number; needed: number; best: { slot: PostingSlot; posts: number; median: number } | null; weekdays: 'weekdays' | 'weekend' | null; overall: number };
export type PostingTimesView = { timeZone: string; days: number; channels: PostingTimesChannel[] };
