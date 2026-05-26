import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

const nativeRequire = eval('require') as NodeRequire;
function agentModule(relPath: string) {
  return nativeRequire(path.join(process.cwd(), '..', 'crewinjob-agent', relPath));
}

interface SendBody {
  /** 'channel' | 'single' | 'broadcast' */
  mode:        'channel' | 'single' | 'broadcast';
  /** Tek alıcı chat_id (mode=single) */
  chatId?:     string | number;
  /** Toplu alıcı chat_id listesi (mode=broadcast) */
  chatIds?:    (string | number)[];
  /** Mesaj metni */
  text:        string;
  /** 'HTML' | 'Markdown' | 'MarkdownV2' — varsayılan: 'HTML' */
  parseMode?:  'HTML' | 'Markdown' | 'MarkdownV2';
  /** Inline butonlar [[{ text, url? }]] (opsiyonel) */
  buttons?:    { text: string; url?: string; callback_data?: string }[][];
}

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, chatId, chatIds, text, parseMode = 'HTML', buttons } = body;

    if (!text) {
      return NextResponse.json({ error: '"text" zorunlu.' }, { status: 400 });
    }

    const send = agentModule('modules/messaging-send.js');

    if (mode === 'channel') {
      const result = buttons
        ? await send.sendTelegramWithButtons(
            process.env.TELEGRAM_CHANNEL_ID,
            text,
            buttons,
          )
        : await send.sendToDefaultChannel(text, parseMode);
      return NextResponse.json(result);
    }

    if (mode === 'single') {
      if (!chatId) {
        return NextResponse.json({ error: '"chatId" zorunlu.' }, { status: 400 });
      }
      const result = buttons
        ? await send.sendTelegramWithButtons(chatId, text, buttons)
        : await send.sendTelegramMessage(chatId, text, parseMode);
      return NextResponse.json(result);
    }

    if (mode === 'broadcast') {
      if (!chatIds || chatIds.length === 0) {
        return NextResponse.json({ error: '"chatIds" zorunlu.' }, { status: 400 });
      }
      if (chatIds.length > 1000) {
        return NextResponse.json({ error: 'Tek seferde max 1000 chat_id gönderilebilir.' }, { status: 400 });
      }
      const result = await send.broadcastTelegram(chatIds, text, parseMode);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Geçersiz mode: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
