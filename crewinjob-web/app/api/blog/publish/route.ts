/**
 * POST /api/blog/publish
 *
 * Pipeline:
 *  1. Blog içeriğinden başlık + slug çıkar
 *  2. Görsel üret (veya gönderilen imageData'yı kullan)
 *  3. Görseli sunucuya kaydet: public/images/blog/<slug>.png
 *  4. POST /api/services/app/Blog/CreateOrEdit  (ABP Bearer token ile)
 */
import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';
import { internalFetch, publicAppUrl } from '@/lib/internal-fetch';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const API_BASE    = (process.env.CREWINJOB_API_URL || 'https://api.crewin.org').replace(/\/$/, '');
const BLOG_IMG_DIR = path.join(process.cwd(), 'public', 'images', 'blog');

// ── ABP Token (S3 upload + Blog/CreateOrEdit için) ────────────────
let _abpToken      = '';
let _abpTokenExp   = 0;
let _abpLoginLock: Promise<string> | null = null;

async function getAbpToken(): Promise<string> {
  const directKey = process.env.CREWINJOB_API_KEY || '';
  if (directKey) return directKey;

  const username = process.env.CREWINJOB_API_USERNAME || '';
  const password = process.env.CREWINJOB_API_PASSWORD || '';
  if (!username || !password) throw new Error('CREWINJOB_API_USERNAME / PASSWORD .env dosyasında tanımlı değil');

  if (_abpToken && Date.now() < _abpTokenExp) return _abpToken;
  if (_abpLoginLock) return _abpLoginLock;

  _abpLoginLock = (async () => {
    const res  = await fetch(`${API_BASE}/api/TokenAuth/Authenticate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ userNameOrEmailAddress: username, password }),
      signal:  AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`ABP login HTTP ${res.status}`);
    const data: { result?: { accessToken?: string; expireInSeconds?: number } } = await res.json();
    const result = data.result;
    if (!result?.accessToken) throw new Error('ABP login: accessToken yok');
    _abpToken    = result.accessToken;
    _abpTokenExp = Date.now() + (result.expireInSeconds || 86400) * 1000 - 60000;
    return _abpToken;
  })().finally(() => { _abpLoginLock = null; });

  return _abpLoginLock;
}

function ensureBlogImgDir() {
  fs.mkdirSync(BLOG_IMG_DIR, { recursive: true });
}

// ── Başlıktan noktalama temizle (URL slug için) ───────────────────────────────
function cleanTitle(title: string): string {
  return title
    .replace(/[:\-–—!?,"'`;]/g, ' ')  // noktalama → boşluk
    .replace(/\s+/g, ' ')              // çoklu boşluk → tek
    .trim()
    .slice(0, 120);
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

// ── H1 başlığını çıkar ve temizle ─────────────────────────────────────────────
function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
    ?? content.match(/^H1:\s*\[?(.+?)\]?\s*$/m)
    ?? content.match(/H1:\s*\[?([^\]\n]+)\]?/);
  const raw = h1
    ? h1[1].trim().replace(/[\[\]]/g, '')
    : (content.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || 'CrewinJob Blog');
  return cleanTitle(raw);
}

// ── Sadece makale gövdesini çıkar (SEO metadata + sosyal medya bölümlerini at) ─
function extractArticleBody(content: string): string {
  let body = content;

  // 1. "## MAKALE ..." satırından başla — ama o satırın kendisini at
  const makaleMatch = body.match(/^##\s*MAKALE[^\n]*/im);
  if (makaleMatch) {
    const idx = body.indexOf(makaleMatch[0]);
    body = body.slice(idx + makaleMatch[0].length).trim();
  }

  // 2. H1 satırını (başlık tekrarı) at — makale içeriği H2'den başlasın
  body = body.replace(/^H1:\s*\[?[^\]\n]+\]?\s*/im, '').trim();
  body = body.replace(/^#\s+[^\n]+\n/, '').trim();

  // 3. "## SEO METADATA" ve sonrasını kes
  const stopPatterns = [
    /^##\s*(SEO\s*METADATA|META\s*DATA|METADATA)/im,
    /^##\s*SOSYAL\s*MEDYA/im,
    /^##\s*SOCIAL\s*MEDIA/im,
    /^##\s*(✅\s*)?ONAY/im,
    /^---+$/m,
  ];
  for (const pat of stopPatterns) {
    const m = body.match(pat);
    if (m) {
      const idx = body.indexOf(m[0]);
      if (idx > 100) body = body.slice(0, idx);
    }
  }

  return body.trim();
}

// ── Görseli crewinjob S3'e yükle → public URL döner ──────────────────────────
const S3_BUCKET   = 'crewisions3';
const S3_SUBDIR   = 'crewinfile';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com/${S3_SUBDIR}`;

async function uploadToS3(base64: string, mime: string, filename: string): Promise<string | null> {
  try {
    const token  = await getAbpToken();
    const buffer = Buffer.from(base64, 'base64');
    const blob   = new Blob([buffer], { type: mime });
    const form   = new FormData();
    form.append('file', blob, filename);

    const params = new URLSearchParams({
      bucketName:           S3_BUCKET,
      subDirectoryInBucket: S3_SUBDIR,
      fileNameInS3:         filename,
    });

    const res = await fetch(
      `${API_BASE}/api/services/app/FirmaGenel/sendMyFileToS3?${params}`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    form,
        signal:  AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) { console.warn(`[blog/publish] S3 HTTP ${res.status}`); return null; }

    const text = await res.text().then(t => t.trim());
    console.log(`[blog/publish] S3 response: ${text.slice(0, 200)}`);

    // ABP JSON response: { result: true, success: true, ... }
    let isOk = false;
    try {
      const json = JSON.parse(text) as { result?: unknown; success?: boolean };
      isOk = json.success === true || json.result === true || typeof json.result === 'string';
    } catch {
      // Düz metin yanıt
      isOk = text === 'true' || text === '"true"' || text.startsWith('http');
    }

    if (isOk) {
      const publicUrl = `${S3_BASE_URL}/${filename}`;
      console.log(`[blog/publish] S3 OK: ${publicUrl}`);
      return publicUrl;
    }
    console.warn('[blog/publish] S3 başarısız:', text);
    return null;
  } catch (e) {
    console.warn('[blog/publish] S3 hata:', e);
    return null;
  }
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────
// Public blog'a gider → metin önce HTML-escape edilir (stored XSS), inline markdown sonra uygulanır.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(raw: string): string {
  // Linkler placeholder'a alınır (URL içindeki * vb. bold/em dönüşümüne girmesin); yalnızca http(s)
  const links: string[] = [];
  let text = raw.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (!/^https?:\/\//i.test(url)) return label;
    links.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  text = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '');
}

function mdToHtml(md: string): string {
  const html: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;   // açık liste tipi — doğru etiketle kapatılır
  const closeList = () => { if (listTag) { html.push(`</${listTag}>`); listTag = null; } };
  const openList  = (tag: 'ul' | 'ol') => { if (listTag !== tag) { closeList(); html.push(`<${tag}>`); listTag = tag; } };

  for (const line of md.replace(/\u0000/g, '').split('\n')) {
    let m: RegExpMatchArray | null;
    if      ((m = line.match(/^(#{1,4})\s+(.*)$/))) { closeList(); const n = m[1].length; html.push(`<h${n}>${inlineMd(m[2])}</h${n}>`); }
    else if ((m = line.match(/^[-*]\s+(.*)$/)))      { openList('ul'); html.push(`<li>${inlineMd(m[1])}</li>`); }
    else if ((m = line.match(/^\d+\.\s+(.*)$/)))    { openList('ol'); html.push(`<li>${inlineMd(m[1])}</li>`); }
    else if (line.trim() === '')                     { closeList(); html.push(''); }
    else                                             { closeList(); html.push(`<p>${inlineMd(line)}</p>`); }
  }
  closeList();
  return html.join('\n');
}

// ── Görseli yerel diske kaydet (yedek) — hata yayını asla düşürmez ─────────────
function saveImageLocally(base64: string, mime: string, slug: string): string {
  try {
    ensureBlogImgDir();
    const ext      = mime.includes('png') ? 'png' : 'jpg';
    const filename = `${slug}-${Date.now()}.${ext}`;
    const filePath = path.join(BLOG_IMG_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    console.log(`[blog/publish] Görsel kaydedildi: ${filePath}`);
    return filename;
  } catch (e) {
    console.warn('[blog/publish] Yerel görsel kaydı başarısız (yayın etkilenmez):', e);
    return '';
  }
}

// ── Görseli imgbb'ye yükle → public URL döner ─────────────────────────────────
async function uploadToImgbb(base64: string): Promise<string | null> {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) { console.warn('[blog/publish] IMGBB_API_KEY eksik'); return null; }

  try {
    const form = new URLSearchParams();
    form.append('key',   apiKey);
    form.append('image', base64);

    const res  = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body:   form,
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json() as { success?: boolean; data?: { url?: string; display_url?: string } };
    if (json.success && json.data?.url) {
      console.log(`[blog/publish] imgbb URL: ${json.data.url}`);
      return json.data.url;
    }
    console.warn('[blog/publish] imgbb yükleme başarısız:', JSON.stringify(json));
    return null;
  } catch (e) {
    console.warn('[blog/publish] imgbb hata:', e);
    return null;
  }
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
      // Dahili çağrı → servis oturumu cookie'si ile (aksi halde middleware 401 döner)
      const imgRes = await internalFetch('/api/generate-image', {
        method:  'POST',
        body:    JSON.stringify({
          platform:    'blog',
          contentType: 'blog',
          textContent: content.slice(0, 500),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const imgJson = await imgRes.json().catch(() => ({})) as { imageData?: string; mimeType?: string; error?: string };
      if (!imgRes.ok) console.warn(`[blog/publish] Görsel üretimi HTTP ${imgRes.status}: ${imgJson.error ?? ''}`);
      if (imgRes.ok && !imgJson.error && imgJson.imageData) {
        imgBase64 = imgJson.imageData;
        imgMime   = imgJson.mimeType || 'image/jpeg';
        console.log('[blog/publish] Görsel üretildi');
      }
    } catch (e) {
      console.warn('[blog/publish] Görsel üretilemedi:', e);
    }
  }

  // 3. Görseli yükle: önce S3, başarısız olursa imgbb, son çare yerel
  let imageFileName = '';
  let localImageUrl = '';
  let finalImageUrl: string | null = null;

  if (imgBase64) {
    const ext        = imgMime.includes('png') ? 'png' : 'jpg';
    const s3Filename = `${slug}-${Date.now()}.${ext}`;

    // 3a. crewinjob S3 — dosya adını döner, site kendi prefix'ini ekler
    const s3Name = await uploadToS3(imgBase64, imgMime, s3Filename);
    if (s3Name) {
      finalImageUrl = s3Name;
    } else {
      // 3b. S3 başarısız → imgbb tam URL
      finalImageUrl = await uploadToImgbb(imgBase64);
    }

    // 3c. Yerel yedek (yalnızca arşiv — kanonik URL S3/imgbb)
    imageFileName = saveImageLocally(imgBase64, imgMime, slug);
    localImageUrl = imageFileName ? `${publicAppUrl()}/images/blog/${imageFileName}` : '';
  }

  // 4. Sadece makale gövdesini al, sonra Markdown → HTML
  const articleBody = extractArticleBody(content);
  const htmlContent = mdToHtml(articleBody);

  // 5. Blog yayınla (ABP endpoint'i yetkili çağrı ister)
  let abpToken: string;
  try {
    abpToken = await getAbpToken();
  } catch (e) {
    return NextResponse.json({ error: `Blog yayınlanamadı: ABP oturumu açılamadı — ${(e as Error).message}` }, { status: 502 });
  }
  const blogRes = await fetch(`${API_BASE}/api/services/app/Blog/CreateOrEdit`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${abpToken}` },
    body:    JSON.stringify({ id: null, title, content: htmlContent, imageUrl: finalImageUrl }),
    signal:  AbortSignal.timeout(15000),
  });

  if (!blogRes.ok) {
    const errText = await blogRes.text().catch(() => '');
    return NextResponse.json(
      { error: `Blog yayınlanamadı: HTTP ${blogRes.status}${errText ? ' — ' + errText.slice(0, 200) : ''}` },
      { status: blogRes.status },
    );
  }

  const blogData = await blogRes.json() as { result?: { id?: number }; id?: number; success?: boolean };
  if (!blogData.success) {
    return NextResponse.json({ error: 'Blog yayınlanamadı' }, { status: 500 });
  }

  const blogId = blogData?.result?.id ?? blogData?.id ?? 0;

  return NextResponse.json({
    success: true,
    blogId,
    title,
    imageUrl:     finalImageUrl,
    imageFileName,
    localImageUrl,
    syncNote: finalImageUrl
      ? `Görsel yüklendi: ${finalImageUrl}`
      : imageFileName
        ? `Görsel yerel kaydedildi: ${localImageUrl}`
        : '',
  });
}

// GET — kayıtlı blog görsellerinin listesi
export async function GET() {
  try {
    ensureBlogImgDir();
    const files = fs.readdirSync(BLOG_IMG_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map(f => ({
        filename: f,
        url:      `${publicAppUrl()}/images/blog/${f}`,
        size:     fs.statSync(path.join(BLOG_IMG_DIR, f)).size,
        created:  fs.statSync(path.join(BLOG_IMG_DIR, f)).birthtime,
      }))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return NextResponse.json({ count: files.length, files });
  } catch {
    return NextResponse.json({ count: 0, files: [] });
  }
}
