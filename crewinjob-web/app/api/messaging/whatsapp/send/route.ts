import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

interface SendBody {
  mode:          'single' | 'broadcast' | 'template';
  to?:           string;
  numbers?:      string[];
  text?:         string;
  templateName?: string;
  langCode?:     string;
  components?:   unknown[];
}

// Meta kuralı: serbest metin yalnızca son 24 saatte işletmeye yazmış kullanıcılara ulaşır;
// pazarlama mesajları için onaylı template gerekir. Gönderim mantığı değişmez, sonuçla birlikte bildirilir.
const FREE_TEXT_NOTICE = 'Serbest metin yalnızca son 24 saat içinde size yazmış kullanıcılara ulaşır; pazarlama mesajları için onaylı WhatsApp template kullanın. / Free-text messages only reach users who messaged you in the last 24 hours; use approved WhatsApp templates for marketing.';

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
      return NextResponse.json({ ...result, notice: FREE_TEXT_NOTICE });
    }

    if (mode === 'broadcast') {
      if (!numbers || numbers.length === 0 || !text) {
        return NextResponse.json({ error: '"numbers" and "text" are required.' }, { status: 400 });
      }
      if (numbers.length > 500) {
        return NextResponse.json({ error: 'Max 500 numbers per request.' }, { status: 400 });
      }
      const result = await send.broadcastWhatsApp(numbers, text);
      return NextResponse.json({ ...result, notice: FREE_TEXT_NOTICE });
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
