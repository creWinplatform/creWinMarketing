import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { Readable } from 'stream';
import zlib from 'zlib';

export type AuditPriority = 'high' | 'medium' | 'low';
export type AuditFinding = { id: string; priority: AuditPriority; category: string; title: string; detail: string; recommendation: string; evidence: string };
export type PageAudit = {
  ok: true; source: 'public_html'; checkedAt: string; requestedUrl: string; finalUrl: string;
  httpStatus: number; redirects: string[]; findings: AuditFinding[];
  summary: { title: string; description: string; h1Count: number; h2Count: number; canonical: string; robots: string | null; imageCount: number; imagesMissingAlt: number; internalLinksChecked: number; schemaBlocks: number; indexStatus: 'unknown'; robotsStatus: number | null; sitemapStatus: number | null; checkedLinks: Array<{ url: string; status: number | null }> };
  limitations: string[];
};

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_LINK_CHECKS = 8;

function isPrivateIpv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224                 // 0/8 "this network", özel, loopback, multicast/rezerve
    || (a === 100 && b >= 64 && b <= 127)                               // 100.64/10 carrier-grade NAT
    || (a === 169 && b === 254)                                         // link-local (bulut metadata dahil)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)    // özel
    || (a === 192 && b === 0 && (c === 0 || c === 2))                   // IETF / TEST-NET-1
    || (a === 198 && (b === 18 || b === 19))                            // benchmark
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113); // TEST-NET-2/3
}

/** IPv6 adresini 8 adet 16-bit gruba açar (gömülü IPv4 ve :: kısaltması dahil); geçersizse null. */
function expandIpv6(ip: string): number[] | null {
  let value = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  const lastColon = value.lastIndexOf(':');
  const tail = value.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIP(tail) !== 4) return null;
    const p = tail.split('.').map(Number);
    value = `${value.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && head.length !== 8) || missing < 0) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const groups = parts.map(part => /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : Number.NaN);
  return groups.length === 8 && groups.every(group => Number.isFinite(group)) ? groups : null;
}

function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip.replace(/^\[|\]$/g, ''));
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) {
    const h = expandIpv6(ip);
    if (!h) return true;
    const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // ::, ::1, IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) ve IPv4-compatible → gömülü IPv4 denetlenir
    if (h.slice(0, 5).every(group => group === 0) && (h[5] === 0xffff || h[5] === 0)) {
      if (h[5] === 0 && h[6] === 0 && h[7] <= 1) return true;
      return isPrivateIpv4(embedded(h[6], h[7]));
    }
    if (h[0] === 0x64 && h[1] === 0xff9b) return isPrivateIpv4(embedded(h[6], h[7]));   // NAT64 64:ff9b::/96
    if (h[0] === 0x2002) return isPrivateIpv4(embedded(h[1], h[2]));                   // 6to4
    if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) return true;                // Teredo, dokümantasyon
    if ((h[0] & 0xfe00) === 0xfc00) return true;                                        // fc00::/7 unique-local
    if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true;          // fe80::/10 link-local, fec0::/10
    if ((h[0] & 0xff00) === 0xff00) return true;                                        // multicast
    return false;
  }
  return true;
}

/** Hostname'i doğrular ve bağlanılacak İLK genel IP'yi döndürür (bağlantı bu IP'ye sabitlenir → DNS rebinding önlenir). */
export async function resolvePublicAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Yalnızca http/https adresleri denetlenebilir.');
  if (url.username || url.password || url.port) throw new Error('Kimlik bilgisi veya özel port içeren URL denetlenemez.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Yerel ağ adresleri denetlenemez.');
  const literal = net.isIP(host);
  if (literal) {
    if (isPrivateIp(host)) throw new Error('Özel ağ adresleri denetlenemez.');
    return { address: host, family: literal === 6 ? 6 : 4 };
  }
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(address => isPrivateIp(address.address))) throw new Error('Bu alan adı özel veya yerel bir ağa çözümleniyor.');
  return { address: addresses[0].address, family: addresses[0].family === 6 ? 6 : 4 };
}

export async function assertPublicUrl(url: URL): Promise<void> {
  await resolvePublicAddress(url);
}

/** Tek istek (yönlendirme takip edilmez); TCP bağlantısı doğrulanmış IP'ye sabitlenir, TLS yine hostname ile doğrulanır. */
export function requestPinned(url: URL, pinned: { address: string; family: 4 | 6 }, accept: string, extraHeaders: Record<string,string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    // Node 20 net.connect autoSelectFamily ile lookup'ı { all: true } çağırır → iki imzayı da karşıla
    const lookup = ((_hostname: string, options: { all?: boolean } | undefined, callback: (...args: unknown[]) => void) => {
      if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    }) as unknown as net.LookupFunction;
    const options: http.RequestOptions = {
      method: 'GET',
      headers: { 'User-Agent': 'CrewinMarketingAudit/1.0 (+https://crewinjob.com)', Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', ...extraHeaders },
      lookup,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),   // gövde okuması da dahil toplam süre sınırı
    };
    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode || 0;
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
        else headers.set(key, String(value));
      }
      const noBody = status === 204 || status === 304 || (status >= 300 && status < 400);
      let stream: Readable = res;
      const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      if (!noBody && ['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) {
        stream = res.pipe(encoding === 'br' ? zlib.createBrotliDecompress() : encoding === 'deflate' ? zlib.createInflate() : zlib.createGunzip());
        headers.delete('content-encoding');
        headers.delete('content-length');
      }
      // pipe() kaynak hatasını iletmez: yanıt akışı hatası (zaman aşımı/bağlantı kopması) dinlenmezse süreç çöker
      res.on('error', error => { if (stream !== res) stream.destroy(error); });
      if (noBody) res.resume();
      try {
        resolve(new Response(noBody ? null : Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status: status >= 200 && status <= 599 ? status : 502, headers }));
      } catch (error) {
        res.destroy();
        reject(error);
      }
    };
    const req = url.protocol === 'https:' ? https.request(url, options, onResponse) : http.request(url, options, onResponse);
    req.on('error', reject);
    req.end();
  });
}

export async function fetchPublic(initialUrl: URL, accept = 'text/html,application/xhtml+xml'): Promise<{ response: Response; finalUrl: URL; redirects: string[] }> {
  let current = initialUrl;
  const redirects: string[] = [];
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    // Her yönlendirme adımı yeniden doğrulanır ve doğrulanan IP'ye bağlanılır (redirect: manual)
    const pinned = await resolvePublicAddress(current);
    const response = await requestPinned(current, pinned, accept);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (attempt === MAX_REDIRECTS) throw new Error('Yönlendirme limiti aşıldı.');
      current = new URL(location, current); redirects.push(current.toString()); continue;
    }
    return { response, finalUrl: current, redirects };
  }
  throw new Error('Sayfa alınamadı.');
}

/** Gövdeyi akış halinde okur; limit aşılırsa okumayı keser (tamamını belleğe almadan). */
export async function readLimited(response: Response, maxBytes = MAX_HTML_BYTES): Promise<string> {
  const tooLarge = () => new Error('Sayfa boyutu denetim limiti üzerinde.');
  if (Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(buffer);
}

/** Yalnızca durum kodu gereken isteklerde gövdeyi kapatır (soket açık kalmasın). */
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

function attribute(tag: string, name: string): string { return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]?.trim() || ''; }
function plain(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function add(findings: AuditFinding[], finding: Omit<AuditFinding, 'id'>) { findings.push({ id: `finding-${findings.length + 1}`, ...finding }); }

function inspectHtml(html: string, pageUrl: URL, status: number, redirects: string[]) {
  const findings: AuditFinding[] = [];
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const descriptionTag = html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i)?.[0] || html.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*["'][^>]*\bname\s*=\s*["']description["'][^>]*>/i)?.[0] || '';
  const description = attribute(descriptionTag, 'content');
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const canonical = attribute(html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i)?.[0] || '', 'href');
  const robots = attribute(html.match(/<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/i)?.[0] || '', 'content');
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = images.filter(tag => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;
  const schemas = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const invalidSchema = schemas.filter(script => { try { JSON.parse(script.replace(/^.*?>/, '').replace(/<\/script>$/i, '').trim()); return false; } catch { return true; } }).length;
  const links = (html.match(/<a\b[^>]*>/gi) || []).map(tag => attribute(tag, 'href')).filter(Boolean);
  const linkTargets = links.filter(href => !href.startsWith('#') && !/^(mailto:|tel:|javascript:)/i.test(href)).map(href => { try { return new URL(href, pageUrl); } catch { return null; } }).filter((url): url is URL => Boolean(url) && url!.origin === pageUrl.origin).filter((url, index, all) => all.findIndex(item => item.href === url.href) === index).slice(0, MAX_LINK_CHECKS);
  const ctaText = [...Array.from(html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)).map(match => plain(match[2])), ...Array.from(html.matchAll(/<input\b[^>]*>/gi)).map(match => attribute(match[0], 'value') || attribute(match[0], 'aria-label'))].filter(Boolean);
  const hasCta = ctaText.some(text => /(kaydol|üye ol|başvur|teklif|randevu|satın al|register|sign up|apply|book|buy|get started)/i.test(text));

  if (status >= 400) add(findings, { priority: 'high', category: 'Erişilebilirlik', title: 'Sayfa başarılı yanıt vermiyor', detail: `HTTP ${status} döndü.`, recommendation: 'Sunucu yanıtını ve yönlendirme kuralını düzeltin.', evidence: `HTTP durum kodu: ${status}` });
  if (redirects.length) add(findings, { priority: redirects.length > 1 ? 'medium' : 'low', category: 'Yönlendirme', title: 'Yönlendirme zinciri bulundu', detail: `${redirects.length} yönlendirme takip edildi.`, recommendation: 'Mümkünse hedef URL’ye tek yönlendirme ile ulaşın.', evidence: redirects.join(' → ') });
  if (!title) add(findings, { priority: 'high', category: 'Meta', title: 'Title etiketi yok', detail: 'Sayfanın belge başlığı bulunamadı.', recommendation: 'Sayfa amacını yansıtan, benzersiz bir title ekleyin.', evidence: '<title> bulunamadı' });
  else if (title.length < 20 || title.length > 65) add(findings, { priority: 'medium', category: 'Meta', title: 'Title uzunluğu gözden geçirilmeli', detail: `${title.length} karakter.`, recommendation: 'Başlığı arama niyeti ve sayfa amacıyla uyumlu, okunabilir uzunlukta düzenleyin.', evidence: title });
  if (!description) add(findings, { priority: 'medium', category: 'Meta', title: 'Meta description yok', detail: 'Arama sonucu açıklaması sayfa tarafından belirtilmiyor.', recommendation: 'Sayfa faydasını ve eylemi anlatan özgün bir meta description ekleyin.', evidence: '<meta name="description"> bulunamadı' });
  else if (description.length < 70 || description.length > 165) add(findings, { priority: 'low', category: 'Meta', title: 'Meta description uzunluğu gözden geçirilmeli', detail: `${description.length} karakter.`, recommendation: 'Açıklamayı kullanıcı niyeti ve CTA ile daha dengeli hale getirin.', evidence: description });
  if (h1Count !== 1) add(findings, { priority: h1Count === 0 ? 'high' : 'medium', category: 'İçerik', title: 'H1 hiyerarşisi net değil', detail: `${h1Count} adet H1 bulundu.`, recommendation: 'Sayfanın ana amacını anlatan tek bir H1 kullanın.', evidence: `H1 sayısı: ${h1Count}` });
  if (!canonical) add(findings, { priority: 'medium', category: 'Canonical', title: 'Canonical bağlantı yok', detail: 'Tercih edilen URL belirtilmemiş.', recommendation: 'Kopya URL riskini azaltmak için canonical bağlantısı ekleyin.', evidence: 'rel="canonical" bulunamadı' });
  if (/noindex/i.test(robots)) add(findings, { priority: 'high', category: 'İndekslenebilirlik', title: 'Sayfa noindex olarak işaretli', detail: 'Sayfa taranabilir olsa dahi indekslenmemesi isteniyor.', recommendation: 'Bu bilinçli değilse robots yönergesini kaldırın.', evidence: `robots: ${robots}` });
  if (imagesMissingAlt) add(findings, { priority: 'low', category: 'Erişilebilirlik', title: 'Alt metni olmayan görseller var', detail: `${imagesMissingAlt} görselde alt metin bulunamadı.`, recommendation: 'Anlam taşıyan görsellere kısa ve açıklayıcı alt metin ekleyin.', evidence: `Toplam görsel: ${images.length}; alt metinsiz: ${imagesMissingAlt}` });
  if (invalidSchema) add(findings, { priority: 'medium', category: 'Yapılandırılmış veri', title: 'Geçersiz JSON-LD bulundu', detail: `${invalidSchema} JSON-LD bloğu JSON olarak ayrıştırılamadı.`, recommendation: 'Yapılandırılmış veri söz dizimini doğrulayın.', evidence: `JSON-LD blokları: ${schemas.length}; geçersiz: ${invalidSchema}` });
  if (!hasCta) add(findings, { priority: 'medium', category: 'Dönüşüm', title: 'Belirgin bir ana CTA bulunamadı', detail: 'Kayıt, teklif, randevu, satın alma veya başvuru niyeti taşıyan görünür bir eylem metni saptanamadı.', recommendation: 'Sayfanın amacına uygun tek bir ana eylemi görünür ve açık biçimde ekleyin.', evidence: `İncelenen bağlantı/düğme metni: ${ctaText.slice(0, 8).join(' | ') || 'yok'}` });
  return { findings, linkTargets, summary: { title, description, h1Count, h2Count, canonical, robots: robots || null, imageCount: images.length, imagesMissingAlt, internalLinksChecked: linkTargets.length, schemaBlocks: schemas.length, indexStatus: 'unknown' as const } };
}

export async function auditPublicPage(input: string): Promise<PageAudit> {
  const requestedUrl = new URL(input);
  const { response, finalUrl, redirects } = await fetchPublic(requestedUrl);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) { discardBody(response); throw new Error('URL HTML sayfası döndürmüyor.'); }
  const audit = inspectHtml(await readLimited(response), finalUrl, response.status, redirects);
  const checkedLinks = await Promise.all(audit.linkTargets.map(async link => { try { const result = await fetchPublic(link, 'text/html,*/*;q=0.8'); discardBody(result.response); return { url: link.toString(), status: result.response.status }; } catch { return { url: link.toString(), status: null }; } }));
  const broken = checkedLinks.filter(link => link.status === null || link.status >= 400);
  if (broken.length) add(audit.findings, { priority: 'medium', category: 'İç bağlantılar', title: 'Kontrol edilen iç bağlantılarda sorun var', detail: `${broken.length} bağlantı başarılı yanıt vermedi.`, recommendation: 'Bağlantı hedeflerini ve yönlendirmelerini doğrulayın.', evidence: broken.map(link => `${link.url} (${link.status ?? 'erişilemedi'})`).join(' | ') });
  const [robotsResult, sitemapResult] = await Promise.allSettled([fetchPublic(new URL('/robots.txt', finalUrl), 'text/plain,*/*;q=0.8'), fetchPublic(new URL('/sitemap.xml', finalUrl), 'application/xml,text/xml,*/*;q=0.8')]);
  for (const result of [robotsResult, sitemapResult]) if (result.status === 'fulfilled') discardBody(result.value.response);
  const robotsStatus = robotsResult.status === 'fulfilled' ? robotsResult.value.response.status : null;
  const sitemapStatus = sitemapResult.status === 'fulfilled' ? sitemapResult.value.response.status : null;
  if (!robotsStatus || robotsStatus >= 400) add(audit.findings, { priority: 'low', category: 'Tarama', title: 'robots.txt doğrulanamadı', detail: 'robots.txt başarılı biçimde alınamadı.', recommendation: 'robots.txt dosyasını yayınlayın ve tarama yönergelerini kontrol edin.', evidence: robotsStatus ? `HTTP ${robotsStatus}` : 'istek başarısız' });
  if (!sitemapStatus || sitemapStatus >= 400) add(audit.findings, { priority: 'low', category: 'Tarama', title: 'Sitemap doğrulanamadı', detail: 'sitemap.xml başarılı biçimde alınamadı.', recommendation: 'Sitemap konumunu ve robots.txt içindeki Sitemap satırını kontrol edin.', evidence: sitemapStatus ? `HTTP ${sitemapStatus}` : 'istek başarısız' });
  return { ok: true, source: 'public_html', checkedAt: new Date().toISOString(), requestedUrl: requestedUrl.toString(), finalUrl: finalUrl.toString(), httpStatus: response.status, redirects, summary: { ...audit.summary, robotsStatus, sitemapStatus, checkedLinks }, findings: audit.findings, limitations: ['Google indeks durumu bu denetimden doğrulanmaz.', 'Hız ve Core Web Vitals ölçülmedi; performans puanı üretilmedi.', `İç bağlantıların yalnızca ilk ${MAX_LINK_CHECKS} benzersiz aynı alan adı hedefi kontrol edildi.`] };
}

function locs(xml: string): string[] { return Array.from(xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)).map(match => match[1].trim().replace(/&amp;/g, '&')).filter(Boolean); }
export async function discoverSiteUrls(input: string, limit: number): Promise<{ baseUrl: string; urls: string[]; source: 'sitemap' | 'homepage_links'; discoveredCount: number }> {
  const baseUrl = new URL(input); await assertPublicUrl(baseUrl);
  const origin = baseUrl.origin;
  const sitemapUrl = new URL('/sitemap.xml', origin);
  let urls: string[] = [];
  try {
    const result = await fetchPublic(sitemapUrl, 'application/xml,text/xml,*/*;q=0.8');
    if (!result.response.ok) discardBody(result.response);
    else {
      const xml = await readLimited(result.response);
      const entries = locs(xml);
      const nested = entries.filter(entry => /sitemap/i.test(entry)).slice(0, 8);
      const direct = entries.filter(entry => !/sitemap/i.test(entry));
      const nestedUrls = await Promise.all(nested.map(async entry => { try { const nestedResult = await fetchPublic(new URL(entry), 'application/xml,text/xml,*/*;q=0.8'); if (!nestedResult.response.ok) { discardBody(nestedResult.response); return []; } return locs(await readLimited(nestedResult.response)); } catch { return []; } }));
      urls = [...direct, ...nestedUrls.flat()];
    }
  } catch { /* sitemap yoksa ana sayfa bağlantıları kullanılacak */ }
  const normalized = urls.map(value => { try { const url = new URL(value, origin); url.hash = ''; return url; } catch { return null; } }).filter((url): url is URL => Boolean(url) && url!.origin === origin).map(url => url.toString()).filter((value, index, all) => all.indexOf(value) === index);
  if (normalized.length) return { baseUrl: origin, urls: normalized.slice(0, limit), source: 'sitemap', discoveredCount: normalized.length };
  const page = await fetchPublic(new URL('/', origin));
  const html = await readLimited(page.response);
  const fallback = (html.match(/<a\b[^>]*>/gi) || []).map(tag => attribute(tag, 'href')).filter(Boolean).map(href => { try { const url = new URL(href, origin); url.hash = ''; return url; } catch { return null; } }).filter((url): url is URL => Boolean(url) && url!.origin === origin).map(url => url.toString()).filter((value, index, all) => all.indexOf(value) === index);
  return { baseUrl: origin, urls: [new URL('/', origin).toString(), ...fallback].slice(0, limit), source: 'homepage_links', discoveredCount: fallback.length + 1 };
}
