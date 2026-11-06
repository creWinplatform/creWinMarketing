'use client';
import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import type { PostingSlot, PostingTimesView } from '@/lib/platform/posting-times-types';

const SLOTS: Record<PostingSlot, [string, string]> = { morning: ['sabah (06–11)', 'morning (6–11)'], noon: ['öğle (11–14)', 'midday (11–14)'], afternoon: ['öğleden sonra (14–18)', 'afternoon (14–18)'], evening: ['akşam (18–23)', 'evening (18–23)'], night: ['gece (23–06)', 'night (23–6)'] };
const NAMES: Record<string, string> = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', telegram: 'Telegram', tiktok: 'TikTok', pinterest: 'Pinterest', youtube: 'YouTube' };

// When your own posts did best, per channel: an observation from your measured posts, shown next to scheduling.
export default function PostingTimes({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1;
  const [view, setView] = useState<PostingTimesView | null>(null);
  useEffect(() => { const controller = new AbortController(); projectRequest<PostingTimesView>('/api/platform/posting-times', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(setView).catch(() => {}); return () => controller.abort(); }, []);
  if (!view?.channels.length) return null;
  return <div className="posting-times" role="note">
    <p><Clock3 size={15} aria-hidden="true" /><strong>{tr ? 'Ne zaman paylaşmalı?' : 'When to post?'}</strong> {tr ? `Son ${view.days} günde etkileşimi ölçülen kendi yayınlarınızdan (${view.timeZone} saati).` : `From your own posts with measured engagement in the last ${view.days} days (${view.timeZone} time).`}</p>
    <ul>{view.channels.map(channel => <li key={channel.platform}><strong>{NAMES[channel.platform] || channel.platform}:</strong> {channel.best
      ? (tr ? `${SLOTS[channel.best.slot][0]} yayınlarınız daha çok etkileşim aldı${channel.weekdays ? `, ${channel.weekdays === 'weekdays' ? 'hafta içi' : 'hafta sonu'} daha iyi` : ''} (${channel.best.posts} yayın, ${channel.posts} ölçülmüş yayından).` : `your ${SLOTS[channel.best.slot][1]} posts got more engagement${channel.weekdays ? `, ${channel.weekdays === 'weekdays' ? 'weekdays' : 'the weekend'} did better` : ''} (${channel.best.posts} posts of ${channel.posts} measured).`)
      : channel.posts < channel.needed ? (tr ? `henüz yeterli veri yok (${channel.posts}/${channel.needed} ölçülmüş yayın).` : `not enough data yet (${channel.posts}/${channel.needed} measured posts).`)
      : (tr ? 'saatler arasında belirgin bir fark görülmedi.' : 'no clear difference between times.')}</li>)}</ul>
    <p className="coach-muted">{tr ? 'Bu bir gözlemdir, kural değildir; konu ve görsel de etkileşimi değiştirir.' : 'This is an observation, not a rule; the topic and image change engagement too.'}</p>
  </div>;
}
