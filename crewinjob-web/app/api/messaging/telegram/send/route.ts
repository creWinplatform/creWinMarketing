import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { newCrewinShareTag, registerCrewinTag, tagCrewinLinks } from '@/lib/platform/crewin-links';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

interface SendBody {
  mode:       'channel' | 'single' | 'broadcast';
  chatId?:    string | number;
  chatIds?:   (string | number)[];
  text:       string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  buttons?:   { text: string; url?: string; callback_data?: string }[][];
}

const PARSE_MODES = ['HTML', 'Markdown', 'MarkdownV2'] as const;

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, chatId, chatIds } = body;
    const parseMode = PARSE_MODES.includes(body.parseMode as typeof PARSE_MODES[number]) ? body.parseMode! : 'HTML';

    if (!body.text) {
      return NextResponse.json({ error: '"text" is required.' }, { status: 400 });
    }

    // crewinjob.com linkleri bu gönderimin rz_ etiketini taşır. Markdown'da "_" biçim sayılır; metin yalnız HTML modunda
    // etiketlenir, butonların linkleri her zaman.
    const tag = newCrewinShareTag();
    let tagged = 0;
    const tagText = (value: string) => { const result = tagCrewinLinks(value, tag, 'telegram', 'social'); tagged += result.tagged; return result.text; };
    if (parseMode === 'HTML') body.text = tagText(body.text);
    const buttons = body.buttons?.map(row => row.map(button => button.url ? { ...button, url: tagText(button.url) } : button));
    const remember = <T,>(result: T) => { if (tagged) { void registerCrewinTag(tag, 'share', body.text).catch(err => console.warn('[link-tags] kayıt yazılamadı:', err)); } return result; };

    const send = agentModule('modules/messaging-send.js');
    // parse_mode=HTML: kullanıcı/kampanya metni düz metindir — <, >, & kaçışlanır (Telegram aksi halde
    // "can't parse entities" ile reddeder veya metni biçim olarak yorumlar). Butonlu gönderim de HTML kullanır.
    const htmlText = send.escapeTelegramHtml(body.text) as string;
    const text = parseMode === 'HTML' ? htmlText : body.text;

    if (mode === 'channel') {
      const result = buttons
        ? await send.sendTelegramWithButtons(process.env.TELEGRAM_CHANNEL_ID, htmlText, buttons)
        : await send.sendToDefaultChannel(text, parseMode);
      return NextResponse.json(remember(result));
    }

    if (mode === 'single') {
      if (!chatId) {
        return NextResponse.json({ error: '"chatId" is required.' }, { status: 400 });
      }
      const result = buttons
        ? await send.sendTelegramWithButtons(chatId, htmlText, buttons)
        : await send.sendTelegramMessage(chatId, text, parseMode);
      return NextResponse.json(remember(result));
    }

    if (mode === 'broadcast') {
      if (!chatIds || chatIds.length === 0) {
        return NextResponse.json({ error: '"chatIds" is required.' }, { status: 400 });
      }
      if (chatIds.length > 1000) {
        return NextResponse.json({ error: 'Max 1000 chat_ids per request.' }, { status: 400 });
      }
      const result = await send.broadcastTelegram(chatIds, text, parseMode);
      return NextResponse.json(remember(result));
    }

    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
