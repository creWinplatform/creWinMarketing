import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

const nativeRequire = eval('require') as NodeRequire;
function agentModule(relPath: string) {
  return nativeRequire(path.join(process.cwd(), '..', 'crewinjob-agent', relPath));
}

interface SendBody {
  /** 'single' | 'broadcast' | 'template' */
  mode:         'single' | 'broadcast' | 'template';
  /** Tek alıcı (mode=single veya template) */
  to?:          string;
  /** Toplu alıcılar (mode=broadcast) */
  numbers?:     string[];
  /** Mesaj metni (mode=single | broadcast) */
  text?:        string;
  /** Template adı (mode=template) */
  templateName?: string;
  /** Template dil kodu (mode=template) */
  langCode?:    string;
  /** Template parametreleri */
  components?:  unknown[];
}

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, to, numbers, text, templateName, langCode, components } = body;

    const send = agentModule('modules/messaging-send.js');

    if (mode === 'single') {
      if (!to || !text) {
        return NextResponse.json({ error: '"to" ve "text" zorunlu.' }, { status: 400 });
      }
      const result = await send.sendWhatsAppMessage(to, text);
      return NextResponse.json(result);
    }

    if (mode === 'broadcast') {
      if (!numbers || numbers.length === 0 || !text) {
        return NextResponse.json({ error: '"numbers" ve "text" zorunlu.' }, { status: 400 });
      }
      if (numbers.length > 500) {
        return NextResponse.json({ error: 'Tek seferde max 500 numara gönderilebilir.' }, { status: 400 });
      }
      const result = await send.broadcastWhatsApp(numbers, text);
      return NextResponse.json(result);
    }

    if (mode === 'template') {
      if (!to || !templateName || !langCode) {
        return NextResponse.json({ error: '"to", "templateName" ve "langCode" zorunlu.' }, { status: 400 });
      }
      const result = await send.sendWhatsAppTemplate(to, templateName, langCode, components ?? []);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Geçersiz mode: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
