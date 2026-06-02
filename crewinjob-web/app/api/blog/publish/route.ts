/**
 * POST /api/blog/publish
 *
 * Pipeline:
 *  1. Blog içeriğinden başlık + slug çıkar
 *  2. Görsel üret (veya gönderilen imageData'yı kullan)
 *  3. Görseli sunucuya kaydet: public/images/blog/<slug>.jpg
 *     → /images/blog/<slug>.jpg olarak servis edilir
 *  4. api.crewin.org token auth
 *  5. POST /api/services/app/Blog/CreateOrEdit  (imageUrl = "<slug>.jpg")
 *
 * Görsel crewinjob.com'da görünmesi için:
 *  - GET /api/blog/images  →  kayıtlı görsellerin listesi
 *  - GET /api/blog/images/[filename]  →  ikili dosya indir
 *  Bu görselleri crewinjob.com sunucusuna kopyalamanız yeterli.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

const API_BASE = (process.env.CREWINJOB_API_URL || 'https://api.crewin.org').replace(/\/$/, '');
const APP_URL  = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3333').replace(/\/$/, '');

// Görsellerin kaydedileceği klasör (Next.js statik dosya dizini)
const BLOG_IMG_DIR = path.join(process.cwd(), 'public', 'images', 'blog');

function ensureBlogImgDir() {
  fs.mkdirSync(BLOG_IMG_DIR, { recursive: true });
}

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
    return _token as string;
  })().finally(() => { _loginPromise = null; });

  return await _loginPromise;
}

// ── Başlıktan URL-safe slug üret ──────────────────────────────────────────────
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[ğ]/g, 'g').replace(/[ü]/g, 'u').replace(/[ş]/g, 's')
    .replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ── H1 başlığını çıkar ────────────────────────────────────────────────────────
function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
    ?? content.match(/^H1:\s*\[?(.+?)\]?\s*$/m)
    ?? content.match(/H1:\s*\[?([^\]\n]+)\]?/);
  if (h1) return h1[1].trim().replace(/[\[\]]/g, '').slice(0, 120);
  const first = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
  return first?.trim().slice(0, 80) || 'CrewinJob Blog';
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────
function mdToHtml(md: string): string {
  const html: string[] = [];
  let inList = false;

  for (const raw of md.split('\n')) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>');

    if      (/^#{4}\s/.test(line)) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h4>${line.replace(/^#{4}\s/,'')}</h4>`); }
    else if (/^#{3}\s/.test(line)) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${line.replace(/^#{3}\s/,'')}</h3>`); }
    else if (/^#{2}\s/.test(line)) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${line.replace(/^#{2}\s/,'')}</h2>`); }
    else if (/^#{1}\s/.test(line)) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${line.replace(/^#{1}\s/,'')}</h1>`); }
    else if (/^[-*]\s/.test(line)) { if (!inList) { html.push('<ul>'); inList = true; }  html.push(`<li>${line.replace(/^[-*]\s/,'')}</li>`); }
    else if (/^\d+\.\s/.test(line)){ if (!inList) { html.push('<ol>'); inList = true; }  html.push(`<li>${line.replace(/^\d+\.\s/,'')}</li>`); }
    else if (line.trim() === '')   { if (inList)  { html.push('</ul>'); inList = false; } html.push(''); }
    else                           { if (inList)  { html.push('</ul>'); inList = false; } html.push(`<p>${line}</p>`); }
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

// ── Görseli sunucuya kaydet ───────────────────────────────────────────────────
function saveImageLocally(base64: string, mime: string, slug: string): string {
  ensureBlogImgDir();
  const ext      = mime.includes('png') ? 'png' : 'jpg';
  const filename = `${slug}-${Date.now()}.${ext}`;
  const filePath = path.join(BLOG_IMG_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  console.log(`[blog/publish] Görsel kaydedildi: ${filePath}`);
  return filename;
}

// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { content, imageData, imageMime } = await req.json() as {
    content:    string;
    imageData?: string;
    imageMime?: string;
  };

  if (!content?.trim()) {
    return NextResponse.json({ error: 'İçerik boş olamaz' }, { status: 400 });
  }

  // 1. Başlık + slug
  const title = extractTitle(content);
  const slug  = toSlug(title);

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
        console.log('[blog/publish] Görsel üretildi');
      }
    } catch (e) {
      console.warn('[blog/publish] Görsel üretilemedi:', e);
    }
  }

  // 3. Görseli public/images/blog/ klasörüne kaydet
  let imageFileName = '';
  let localImageUrl = '';
  if (imgBase64) {
    imageFileName = saveImageLocally(imgBase64, imgMime, slug);
    // Marketing agent üzerinden erişilebilir URL (monitoring/indirme için)
    localImageUrl = `${APP_URL}/images/blog/${imageFileName}`;
    console.log(`[blog/publish] Görsel URL: ${localImageUrl}`);
  }

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

  // 6. Blog yayınla — imageUrl = sadece dosya adı (crewinjob.com pattern: "images/blog/" + imageUrl)
  const blogRes = await fetch(`${API_BASE}/api/services/app/Blog/CreateOrEdit`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:   JSON.stringify({ id: 0, title, content: htmlContent, imageUrl: imageFileName }),
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

  return NextResponse.json({
    success:      true,
    blogId,
    title,
    imageFileName,            // sadece dosya adı — crewinjob.com'a kopyalanacak
    localImageUrl,            // marketing agent üzerindeki URL
    syncNote: imageFileName
      ? `Görsel "${imageFileName}" marketing agent sunucusuna kaydedildi. crewinjob.com'da görünmesi için /images/blog/ klasörüne kopyalayın.`
      : '',
  });
}

// GET — kayıtlı blog görsellerinin listesi (senkronizasyon için)
export async function GET() {
  try {
    ensureBlogImgDir();
    const files = fs.readdirSync(BLOG_IMG_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map(f => ({
        filename: f,
        url:      `${APP_URL}/images/blog/${f}`,
        size:     fs.statSync(path.join(BLOG_IMG_DIR, f)).size,
        created:  fs.statSync(path.join(BLOG_IMG_DIR, f)).birthtime,
      }))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return NextResponse.json({ count: files.length, files });
  } catch {
    return NextResponse.json({ count: 0, files: [] });
  }
}
