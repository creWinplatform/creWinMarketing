import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

const nativeRequire = eval('require') as NodeRequire;
function agentModule(relPath: string) {
  return nativeRequire(path.join(process.cwd(), '..', 'crewinjob-agent', relPath));
}

interface SendBody {
  mode:          'single' | 'broadcast' | 'template';
  to?:           string;
  numbers?:      string[];
  text?:         string;
  templateName?: string;
  langCode?:     string;
  components?:   unknown[];
}

export async function POST(request: NextRequest) {
  try {
    const body: SendBody = await request.json();
    const { mode, to, numbers, text, templateName, langCode, components } = body;

    const send = agentModule('modules/messaging-send.js');

    if (mode === 'single') {
      if (!to || !text) {
        return NextResponse.json({ error: '"to" and "text" are required.' }, { status: 400 });
      }
      const result = await send.sendWhatsAppMessage(to, text);
      return NextResponse.json(result);
    }

    if (mode === 'broadcast') {
      if (!numbers || numbers.length === 0 || !text) {
        return NextResponse.json({ error: '"numbers" and "text" are required.' }, { status: 400 });
      }
      if (numbers.length > 500) {
        return NextResponse.json({ error: 'Max 500 numbers per request.' }, { status: 400 });
      }
      const result = await send.broadcastWhatsApp(numbers, text);
      return NextResponse.json(result);
    }

    if (mode === 'template') {
      if (!to || !templateName || !langCode) {
        return NextResponse.json({ error: '"to", "templateName" and "langCode" are required.' }, { status: 400 });
      }
      const result = await send.sendWhatsAppTemplate(to, templateName, langCode, components ?? []);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
