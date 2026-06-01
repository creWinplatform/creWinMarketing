/**
 * POST /api/blog/publish
 *
 * Pipeline:
 *  1. Blog içeriğinden başlık çıkar
 *  2. Görsel üret (veya gönderilen imageData'yı kullan)
 *  3. ImgBB'ye yükle → imageUrl al
 *  4. api.crewin.org token auth
 *  5. POST /api/services/app/Blog/CreateOrEdit
 */
import { NextRequest, NextResponse } from 'next/server';

const API_BASE = (process.env.CREWINJOB_API_URL || 'https://api.crewin.org').replace(/\/$/, '');
const APP_URL  = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3333').replace(/\/$/, '');

// ── Token cache ───────────────────────────────────────────────────────────────
let _token:        string | null          = null;
let _tokenExpiry   = 0;
let _loginPromise: Promise<string> | null = null;

async function getApiToken(): Promise<string> {
  const apiKey = process.env.CREWINJOB_API_KEY;
  if (apiKey) return apiKey;

  if (_token && Date.now() < _tokenExpiry) return _token;
  if (_loginPromise) return await _loginPromise;

  _loginPromise = (async () => {
    const res = await fetch(`${API_BASE}/api/TokenAuth/Authenticate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({
        userNameOrEmailAddress: process.env.CREWINJOB_API_USERNAME,
        password:               process.env.CREWINJOB_API_PASSWORD,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Login HTTP ${res.status}`);
    const data   = await res.json();
    const result = data.result || data;
    if (!result?.accessToken) throw new Error('accessToken bulunamadı');
    _token       = result.accessToken as string;
    _tokenExpiry = Date.now() + ((result.expireInSeconds as number) || 86400) * 1000 - 60_000;
    return _token;
  })().finally(() => { _loginPromise = null; });

  return await _loginPromise;
}

// ── Markdown → HTML (temel dönüşüm) ──────────────────────────────────────────
function mdToHtml(md: string): string {
  const lines   = md.split('\n');
  const html: string[] = [];
  let inList    = false;

  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>');

    if (/^#{4}\s/.test(line))       { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h4>${line.replace(/^#{4}\s/, '')}</h4>`); }
    else if (/^#{3}\s/.test(line))  { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${line.replace(/^#{3}\s/, '')}</h3>`); }
    else if (/^#{2}\s/.test(line))  { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${line.replace(/^#{2}\s/, '')}</h2>`); }
    else if (/^#{1}\s/.test(line))  { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${line.replace(/^#{1}\s/, '')}</h1>`); }
    else if (/^[-*]\s/.test(line))  { if (!inList) { html.push('<ul>'); inList = true; } html.push(`<li>${line.replace(/^[-*]\s/, '')}</li>`); }
    else if (/^\d+\.\s/.test(line)) { if (!inList) { html.push('<ol>'); inList = true; } html.push(`<li>${line.replace(/^\d+\.\s/, '')}</li>`); }
    else if (line.trim() === '') {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push('');
    }
    else {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<p>${line}</p>`);
    }
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

// ── H1 başlığını çıkar ────────────────────────────────────────────────────────
function extractTitle(content: string): string {
  // ## SEO METADATA bloğunun üstündeki H1
  const h1 = content.match(/^#\s+(.+)$/m)
    ?? content.match(/^H1:\s*\[?(.+?)\]?\s*$/m)
    ?? content.match(/H1:\s*\[?([^\]\n]+)\]?/);
  if (h1) return h1[1].trim().replace(/[\[\]]/g, '').slice(0, 120);

  // İlk dolu satır
  const first = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('##'));
  return first?.trim().slice(0, 80) || 'CrewinJob Blog';
}

// ── ImgBB yükleme ─────────────────────────────────────────────────────────────
async function uploadToImgbb(base64: string): Promise<string> {
  const key = process.env.IMGBB_API_KEY;
  if (!key) return '';
  const body = new URLSearchParams();
  body.append('key',   key);
  body.append('image', base64);
  try {
    const res  = await fetch('https://api.imgbb.com/1/upload', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'Mozilla/5.0 (compatible; CrewinJob/1.0)',
      },
      body:   body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json() as { data?: { url?: string } };
    return data?.data?.url || '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const {
    content,
    imageData,
    imageMime,
  } = await req.json() as {
    content:    string;
    imageData?: string;
    imageMime?: string;
  };

  if (!content?.trim()) {
    return NextResponse.json({ error: 'İçerik boş olamaz' }, { status: 400 });
  }

  // 1. Başlığı çıkar
  const title = extractTitle(content);

  // 2. Görsel — gönderilmediyse üret
  let imgBase64 = imageData || '';
  let imgMime   = imageMime || 'image/jpeg';

  if (!imgBase64) {
    try {
      const imgRes = await fetch(`${APP_URL}/api/generate-image`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform:    'blog',
          contentType: 'blog',
          textContent: content.slice(0, 500),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const imgJson = await imgRes.json() as { imageData?: string; mimeType?: string; error?: string };
      if (!imgJson.error && imgJson.imageData) {
        imgBase64 = imgJson.imageData;
        imgMime   = imgJson.mimeType || 'image/jpeg';
      }
    } catch (e) {
      console.warn('[blog/publish] Görsel üretilemedi:', e);
    }
  }

  // 3. ImgBB'ye yükle
  const imageUrl = imgBase64 ? await uploadToImgbb(imgBase64) : '';
  if (!imageUrl) console.warn('[blog/publish] ImgBB yükleme başarısız veya anahtar yok — imageUrl boş');

  // 4. Markdown → HTML
  const htmlContent = mdToHtml(content);

  // 5. Token
  let token: string;
  try {
    token = await getApiToken();
  } catch (err) {
    return NextResponse.json(
      { error: `API token alınamadı: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // 6. Blog yayınla
  const blogRes = await fetch(`${API_BASE}/api/services/app/Blog/CreateOrEdit`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:   JSON.stringify({ id: 0, title, content: htmlContent, imageUrl }),
    signal: AbortSignal.timeout(15000),
  });

  if (!blogRes.ok) {
    const errText = await blogRes.text().catch(() => '');
    return NextResponse.json(
      { error: `Blog yayınlanamadı: HTTP ${blogRes.status}${errText ? ' — ' + errText.slice(0, 200) : ''}` },
      { status: blogRes.status },
    );
  }

  const blogData = await blogRes.json() as { result?: { id?: number }; id?: number };
  const blogId   = blogData?.result?.id ?? blogData?.id ?? 0;

  return NextResponse.json({ success: true, blogId, title, imageUrl });
}
