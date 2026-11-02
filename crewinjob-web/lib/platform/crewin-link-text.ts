import { LINK_SOURCES, LINK_TAG } from './link-tracking-types';

// The pure half of crewin-links.ts, safe in the browser: SharePanel tags its copy-and-open shares with a tag the server
// issued when the panel opened, without a request between the click and the clipboard write.
const HOST = 'crewinjob.com';
export const CREWIN_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
export const isCrewinSite = (url: URL) => { const name = url.hostname.toLowerCase(); return name === HOST || name.endsWith(`.${HOST}`); };
// GA4 and the report name a channel the way standard posts do (twitter → x).
export const crewinSource = (source: string) => LINK_SOURCES[source] || source;
// An unsubscribe link is never changed, whatever site it is on.
const isUnsubscribe = (url: URL) => /unsubscribe|abonelik/i.test(url.pathname + url.search);

// Adds utm_source/utm_medium/utm_campaign to crewinjob.com links that carry no utm_ parameter yet; other links stay as
// written. In HTML, a link with an & is left alone: re-serialising "&amp;" would break it.
export function tagCrewinLinks(text: string, tag: string, source: string, medium: string, html = false) {
  if (!text || !LINK_TAG.test(tag)) return { text, tagged: 0 };
  let tagged = 0;
  const output = text.replace(CREWIN_URL_PATTERN, match => {
    const trail = match.match(/[.,;:!?)\]}»”’]+$/)?.[0] || '', raw = match.slice(0, match.length - trail.length);
    let url: URL;
    try { url = new URL(raw); } catch { return match; }
    if (!isCrewinSite(url) || isUnsubscribe(url) || url.username || url.password || html && raw.includes('&') || [...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('utm_'))) return match;
    url.searchParams.set('utm_source', crewinSource(source)); url.searchParams.set('utm_medium', medium); url.searchParams.set('utm_campaign', tag);
    tagged++; return url.toString() + trail;
  });
  return { text: output, tagged };
}

// X counts characters before posting; a text the tag would push past 280 goes out as written (and untagged).
export function tagCrewinShare(text: string, tag: string, platform: string) {
  const result = tagCrewinLinks(text, tag, platform, 'social');
  return platform === 'twitter' && result.text.length > 280 ? { text, tagged: 0 } : result;
}
