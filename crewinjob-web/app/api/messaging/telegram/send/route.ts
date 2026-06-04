import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

const nativeRequire = eval('require') as NodeRequire;
function agentModule(relPath: string) {
  return nativeRequire(path.join(process.cwd(), '..', 'crewinjob-agent', relPath));
}

interface SendBody {
  mode:       'channel' | 'single' | 'broadcast';
  chatId?:    string | number;
  chatIds?:   (string | number)[];
  text:       string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  buttons?:   { text: string; url?: string; callback_data?: string }[][];
}

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, chatId, chatIds, text, parseMode = 'HTML', buttons } = body;

    if (!text) {
      return NextResponse.json({ error: '"text" is required.' }, { status: 400 });
    }

    const send = agentModule('modules/messaging-send.js');

    if (mode === 'channel') {
      const result = buttons
        ? await send.sendTelegramWithButtons(process.env.TELEGRAM_CHANNEL_ID, text, buttons)
        : await send.sendToDefaultChannel(text, parseMode);
      return NextResponse.json(result);
    }

    if (mode === 'single') {
      if (!chatId) {
        return NextResponse.json({ error: '"chatId" is required.' }, { status: 400 });
      }
      const result = buttons
        ? await send.sendTelegramWithButtons(chatId, text, buttons)
        : await send.sendTelegramMessage(chatId, text, parseMode);
      return NextResponse.json(result);
    }

    if (mode === 'broadcast') {
      if (!chatIds || chatIds.length === 0) {
        return NextResponse.json({ error: '"chatIds" is required.' }, { status: 400 });
      }
      if (chatIds.length > 1000) {
        return NextResponse.json({ error: 'Max 1000 chat_ids per request.' }, { status: 400 });
      }
      const result = await send.broadcastTelegram(chatIds, text, parseMode);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
