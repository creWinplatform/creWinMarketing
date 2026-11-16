// Comments and messages that need a person soon: complaints (something went wrong) and escalations (fraud, legal or
// consumer-complaint words). Fixed Turkish and English word lists, no AI: free, explainable and the same every time.
// Used by the team alerts and as a badge in the inbox. A match is a hint for a person, never an automatic action.
export type InboxSignal = { level: 'urgent' | 'complaint' | 'none'; matches: string[] };

// Folds case, Turkish dotted/dotless i and diacritics so "ŞİKAYET", "şikâyet" and "sikayet" match the same entry.
export function foldText(value: string) {
  return value.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
// Entries match at the start of a word, so Turkish suffixes count (avukat → avukatıma, dolandırıcı → dolandırıcılar).
// An entry ending in $ must be the whole word (polis$ is not polisiye).
// Escalation: a public accusation or a legal / consumer-authority step.
const URGENT = ['dolandiri', 'dolandirdi', 'sahtekar', 'avukat', 'dava ac', 'davaci', 'mahkeme', 'savcilik', 'polis$', 'polise', 'tuketici hakem', 'hakem heyeti', 'sikayetvar', 'cimer', 'ihbar', 'hirsiz', 'scam', 'fraud', 'lawyer', 'lawsuit', 'sue you', 'police', 'chargeback', 'stolen'];
// Complaint: something did not work, was late, or the person is unhappy or wants their money back.
const COMPLAINT = ['sikayet', 'memnun degil', 'berbat', 'rezalet', 'rezil', 'cok kotu', 'en kotu', 'hayal kirikligi', 'calismiyor', 'acilmiyor', 'hata veriyor', 'sorun yasiyorum', 'sorunu cozun', 'iade', 'geri odeme', 'paramı geri', 'paramızı geri', 'ulasamiyorum', 'cevap vermiyorsunuz', 'cevap yok', 'yanit yok', 'donus yapmadiniz', 'hala bekliyorum', 'gecikti', 'gelmedi', 'teslim edilmedi', 'iptal edin', 'aboneligi iptal', 'magdur', 'kandirildim', 'utanc verici', 'terrible', 'awful', 'worst', 'disappointed', 'not working', 'doesnt work', "doesn't work", 'broken', 'refund', 'money back', 'no response', 'no reply', 'still waiting', 'never arrived', 'cancel my', 'complaint', 'unacceptable', 'ripped off'];
const ANGRY = /[😡🤬😠👎💩]/u;
const words = (list: string[]) => list.map(entry => { const whole = entry.endsWith('$'), item = whole ? entry.slice(0, -1) : entry; return { item, pattern: new RegExp(`(?:^|[^a-z0-9])${foldText(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${whole ? '(?:$|[^a-z0-9])' : ''}`) }; });
const URGENT_WORDS = words(URGENT), COMPLAINT_WORDS = words(COMPLAINT);

// Folds the text and remembers, for every folded character, which original character it came from.
function foldWithMap(text: string) {
  let folded = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = foldText(text[i]).replace(/\s+/g, ' ');
    for (const char of piece) { folded += char; from.push(i); }
  }
  return { folded, from };
}
// The words as the person wrote them ("Dolandırıcılar"), not the folded list entry.
function found(text: string, map: { folded: string; from: number[] }, entries: { item: string; pattern: RegExp }[]) {
  const out: string[] = [];
  for (const entry of entries) {
    const match = entry.pattern.exec(map.folded);
    if (!match) continue;
    let start = match.index + (/^[a-z0-9]/.test(match[0]) ? 0 : 1), end = match.index + match[0].length;
    while (end > start && !/[a-z0-9]/.test(map.folded[end - 1])) end--;
    while (end < map.folded.length && /[a-z0-9]/.test(map.folded[end])) end++;
    const word = text.slice(map.from[start], map.from[end - 1] + 1).trim();
    if (word && !out.includes(word)) out.push(word.slice(0, 40));
  }
  return out;
}
export function inboxSignal(text: string): InboxSignal {
  const map = foldWithMap(text || '');
  if (!map.folded.trim()) return { level: 'none', matches: [] };
  const urgent = found(text, map, URGENT_WORDS);
  if (urgent.length) return { level: 'urgent', matches: urgent.slice(0, 3) };
  const complaint = found(text, map, COMPLAINT_WORDS);
  if (ANGRY.test(text)) complaint.push('😡');
  return complaint.length ? { level: 'complaint', matches: complaint.slice(0, 3) } : { level: 'none', matches: [] };
}
