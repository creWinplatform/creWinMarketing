// Platform hedef çözünürlükleri (sosyal medya standartları)
export const PLATFORM_TARGET: Record<string, [number, number]> = {
  instagram:           [1080, 1080],
  facebook:            [1200,  630],
  twitter:             [1200,  675],
  linkedin:            [1200,  627],
  tiktok:              [1080, 1920],
  tiktok_cta:          [1080, 1920],
  blog:                [1200,  630],
  retention:           [1080, 1080],
  registration:        [1080, 1080],
  seo_job:             [1200,  630],
  kpi:                 [1200,  630],
  google:              [1200,  628],
  facebook_ads:        [1200, 1200],
  google_ads:          [1200,  628],
  instagram_ads:       [1080, 1080],
  linkedin_ads:        [1200,  627],
  click_to_whatsapp:   [1200, 1200],
  telegram_channel:    [1080, 1080],
  telegram_bot:        [1200,  630],
  keyword:             [1200,  630],
  competitor:          [1200,  630],
};

function loadImage(base64: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/png;base64,${base64}`;
  });
}

/**
 * Arka planı soyulmuş logo önbelleği (anahtar: data URL).
 * compositePostImage başlık değişiminde yeniden çağrılıyor; aynı logoyu her
 * seferinde piksel piksel işlemek arayüzü donduruyordu.
 */
const STRIP_CACHE = new Map<string, HTMLCanvasElement>();

interface LogoLook {
  /** true → mürekkep KOYU; koyu çubukta okunmaz, açık panel gerekir. */
  needsLightCard: boolean;
  /** true → logonun kendi zemini opak; çizmeden önce soyulmalı. */
  bgOpaque: boolean;
  /** Tekdüze kenar boşluğu kırpılmış kaynak dikdörtgeni (doğal piksel cinsinden). */
  crop: { x: number; y: number; w: number; h: number };
  /**
   * Mürekkebin zemine EN YAKIN olduğu renk mesafesi. Zemin soyma eşikleri buna
   * göre daraltılır: beyaz-üstüne-beyaz logoda (fark ~14) sabit eşik mürekkebi
   * de siliyordu.
   */
  minInkDist: number;
}

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Logoyu inceleyip alt çubukta nasıl sunulacağını belirler.
 *
 * Karar ölçütü MÜREKKEP parlaklığıdır, zeminin değil:
 *  - Koyu mürekkep (ör. lacivert IMHFC) → koyu çubukta okunmaz, açık panel gerekir.
 *  - Açık mürekkep (ör. beyaz crewin)   → kapsız, doğrudan çubuk üstünde.
 * Zemin ayrı bir mesele: opaksa her iki durumda da soyulur.
 *
 * (Önceki sürüm opak zeminli logolarda zemin parlaklığına bakıyordu; bu yüzden
 * açık gri zemine kaydedilmiş BEYAZ logo da panele giriyor ve panelin üstünde
 * görünmez oluyordu.)
 *
 * Ayrıca logonun etrafındaki tekdüze boşluk kırpılır — aksi halde panel içinde
 * çift dolgu oluşup logo küçük görünür.
 */
function analyzeLogo(img: HTMLImageElement): LogoLook {
  const full = { x: 0, y: 0, w: img.width, h: img.height };
  const fallback: LogoLook = { needsLightCard: false, bgOpaque: false, crop: full, minInkDist: 255 };

  const sw = Math.max(1, Math.min(160, img.width));
  const sh = Math.max(1, Math.min(160, img.height));
  const c  = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return fallback;

  let data: Uint8ClampedArray;
  try {
    x.drawImage(img, 0, 0, sw, sh);
    data = x.getImageData(0, 0, sw, sh).data;
  } catch {
    return fallback;   // güvenlik kısıtı vb. — varsayılan davranışa dön
  }

  const at = (px: number, py: number) => {
    const i = (py * sw + px) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] / 255 };
  };

  // Köşelerin ortalaması zemin rengi sayılır
  const corners = [at(0, 0), at(sw - 1, 0), at(0, sh - 1), at(sw - 1, sh - 1)];
  const bgA   = corners.reduce((s, p) => s + p.a, 0) / 4;
  const bgR   = corners.reduce((s, p) => s + p.r, 0) / 4;
  const bgG   = corners.reduce((s, p) => s + p.g, 0) / 4;
  const bgB   = corners.reduce((s, p) => s + p.b, 0) / 4;
  const bgOpaque = bgA > 0.5;

  // İçerik pikselleri: zeminden yeterince ayrışanlar.
  //
  // Eşik UYARLAMALIDIR. Sabit eşik, açık gri zemine (#f7f7f7) kaydedilmiş BEYAZ
  // logoda hiç içerik bulamıyordu — aradaki fark eşiğin çok altında kalıyor.
  // Yüksek eşikle başlanır (gürültüye dayanıklı), sonuç boş çıkarsa kademeli düşülür.
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  let inkLumSum = 0, inkCount = 0, minInkDist = Infinity;

  const scan = (threshold: number) => {
    minX = sw; minY = sh; maxX = -1; maxY = -1;
    inkLumSum = 0; inkCount = 0; minInkDist = Infinity;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const p = at(px, py);
        const dr = p.r - bgR, dg = p.g - bgG, db = p.b - bgB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        const isContent = bgOpaque ? dist > threshold : p.a > 0.3;
        if (!isContent) continue;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (bgOpaque && dist < minInkDist) minInkDist = dist;
        inkLumSum += luma(p.r, p.g, p.b);
        inkCount++;
      }
    }
  };

  // Şeffaf zeminde eşik kullanılmaz; opak zeminde kademeli iner.
  for (const th of bgOpaque ? [36, 20, 10] : [0]) {
    scan(th);
    if (inkCount > 0) break;
  }

  if (inkCount === 0 || maxX < minX || maxY < minY) return fallback;

  // Kart kararı MÜREKKEBE bakar: koyu mürekkep koyu çubukta okunmaz.
  const inkLum = inkLumSum / inkCount;
  const needsLightCard = inkLum < 0.5;
  if (!Number.isFinite(minInkDist)) minInkDist = 255;

  // Örnekleme ölçeğinden doğal piksele geri ölçekle, bir miktar pay bırak
  const kx = img.width / sw;
  const ky = img.height / sh;
  const padX = sw * 0.01, padY = sh * 0.01;
  const cx = Math.max(0, (minX - padX)) * kx;
  const cy = Math.max(0, (minY - padY)) * ky;
  const cw = Math.min(sw, maxX + 1 + padX) * kx - cx;
  const ch = Math.min(sh, maxY + 1 + padY) * ky - cy;

  if (cw <= 0 || ch <= 0) return { needsLightCard, bgOpaque, crop: full, minInkDist };
  return { needsLightCard, bgOpaque, crop: { x: cx, y: cy, w: cw, h: ch }, minInkDist };
}

/**
 * Arka plan üzerine profesyonel brand katmanları çizer:
 * gradient overlay → headline → tagline → bottom bar → logo(lar)
 * Arka plan platform hedef çözünürlüğüne (PLATFORM_TARGET) cover-crop ile kırpılır —
 * çıktı her zaman tam W×H'dir; katmanlar bu boyuta göre çizilir. PNG (kayıpsız) döndürür.
 *
 * `partnerLogoBase64` verilirse (fuar/etkinlik/işbirliği logosu) alt çubukta
 * crewinjob logosunun soluna "×" ayracıyla eklenir. Crewinjob logosu her zaman
 * sağ köşede kalır — partner olsun olmasın marka konumu değişmez.
 */
export async function compositePostImage(
  imageMime: string,
  imageBase64: string,
  logoBase64: string,
  headline: string,
  platform: string,
  partnerLogoBase64 = '',
  subline = '',
): Promise<string> {
  try {
    const faces = [
      new FontFace('Inter', 'url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2)', { weight: '800' }),
      new FontFace('Inter', 'url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2)', { weight: '600' }),
      new FontFace('Inter', 'url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2)', { weight: '400' }),
    ];
    const loaded = await Promise.allSettled(faces.map(f => f.load()));
    loaded.forEach((r, i) => { if (r.status === 'fulfilled') document.fonts.add(faces[i]); });
  } catch { /* system font fallback */ }

  const FF = 'Inter, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve(imageBase64);

    const bg = new Image();
    bg.crossOrigin = 'anonymous';
    bg.onload = async () => {
      const [targetW, targetH] = PLATFORM_TARGET[platform] || [1080, 1080];
      // Tuval her zaman tam hedef boyut: arka plan en-boy oranı korunarak "cover" ölçeklenir,
      // taşan kısım ortadan kırpılır (kare arka plan 1.91:1 / 9:16 hedefe de doğru oturur).
      const W = targetW;
      const H = targetH;
      canvas.width  = W;
      canvas.height = H;

      const srcAspect = bg.width / bg.height;
      const dstAspect = W / H;
      let sx = 0, sy = 0, sw = bg.width, sh = bg.height;
      if (srcAspect > dstAspect) {
        sw = bg.height * dstAspect;
        sx = (bg.width - sw) / 2;
      } else {
        sh = bg.width / dstAspect;
        sy = (bg.height - sh) / 2;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, W, H);

      // Tipografi ölçeği: yatay formatlarda (1.91:1) genişliğe göre ölçeklemek başlığı yüksekliğe
      // sığmayacak kadar büyütüyordu → genişlik, yüksekliğin 1.4 katıyla sınırlanır.
      const S = Math.min(W, H * 1.4);

      const botGrad = ctx.createLinearGradient(0, H * 0.18, 0, H * 0.88);
      botGrad.addColorStop(0,    'rgba(5,11,25,0)');
      botGrad.addColorStop(0.38, 'rgba(5,11,25,0.58)');
      botGrad.addColorStop(0.72, 'rgba(5,11,25,0.86)');
      botGrad.addColorStop(1,    'rgba(5,11,25,0.97)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, 0, W, H);

      const leftGrad = ctx.createLinearGradient(0, 0, W * 0.68, 0);
      leftGrad.addColorStop(0,    'rgba(5,11,25,0.52)');
      leftGrad.addColorStop(0.55, 'rgba(5,11,25,0.14)');
      leftGrad.addColorStop(1,    'rgba(5,11,25,0)');
      ctx.fillStyle = leftGrad;
      ctx.fillRect(0, 0, W, H);

      const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.28);
      topGrad.addColorStop(0, 'rgba(5,11,25,0.32)');
      topGrad.addColorStop(1, 'rgba(5,11,25,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, H);

      const pad = Math.round(W * 0.075);
      const contentTop = Math.round(H * 0.46);

      const accentW  = Math.round(W * 0.048);
      const accentH2 = Math.max(3, Math.round(H * 0.0038));
      ctx.fillStyle  = '#0ea5e9';
      ctx.shadowColor = 'rgba(14,165,233,0.6)';
      ctx.shadowBlur  = 8;
      ctx.fillRect(pad, contentTop, accentW, accentH2);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

      const fontSize = Math.round(S * 0.060);
      ctx.font        = `800 ${fontSize}px ${FF}`;
      ctx.fillStyle   = '#ffffff';
      ctx.shadowColor    = 'rgba(0,0,0,0.80)';
      ctx.shadowBlur     = 32;
      ctx.shadowOffsetX  = 0;
      ctx.shadowOffsetY  = 4;

      // Metin genişliği: logo için sağda yer bırak (%52 yerine eski %58 düzeltildi)
      const maxTW = W * 0.52;
      const rawLines = headline.split('\n');
      const wrappedLines: string[] = [];
      for (const raw of rawLines) {
        const words = raw.split(' ');
        let cur = '';
        for (const w of words) {
          const test = cur + w + ' ';
          if (ctx.measureText(test).width > maxTW && cur) {
            wrappedLines.push(cur.trim());
            cur = w + ' ';
          } else { cur = test; }
        }
        if (cur.trim()) wrappedLines.push(cur.trim());
      }

      const lineH      = Math.round(fontSize * 1.20);
      const textStartY = contentTop + Math.round(fontSize * 1.25);
      // Maksimum 4 satır ve alt çubuğun (H * 0.10) üstünde kalacak kadar — çakışmayı önler
      const lineRoom     = Math.floor((H * 0.86 - textStartY) / lineH) + 1;
      const visibleLines = wrappedLines.slice(0, Math.max(1, Math.min(4, lineRoom)));
      visibleLines.forEach((line, i) => ctx.fillText(line, pad, textStartY + i * lineH));
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';

      // ── Detay satırı (yer / tarih / stant no) ────────────────────────────────
      // Bu bilgiler görsel modeline yazdırılamaz — prompt yazıyı yasaklıyor ve
      // model zaten okunaksız harfler üretiyor. Bu yüzden canvas'a çiziliyor:
      // net, doğru yazımlı ve konumu garanti.
      const sub = subline.trim();
      if (sub) {
        const subY  = textStartY + (visibleLines.length - 1) * lineH + Math.round(fontSize * 0.86);
        const subFs = Math.round(S * 0.0225);

        // İnce aksan çizgisi — detayı başlıktan ayırır
        const ruleW = Math.round(W * 0.030);
        const ruleT = Math.max(2, Math.round(H * 0.0022));
        ctx.fillStyle = 'rgba(56,189,248,0.85)';
        ctx.fillRect(pad, subY - Math.round(subFs * 0.85), ruleW, ruleT);

        ctx.font         = `600 ${subFs}px ${FF}`;
        ctx.fillStyle    = 'rgba(235,245,255,0.94)';
        ctx.shadowColor  = 'rgba(0,0,0,0.72)';
        ctx.shadowBlur   = 18;
        ctx.shadowOffsetY = 2;
        try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0.01em'; } catch { /* yok say */ }

        // En fazla 2 satır — alt çubukla çakışmasın
        const subLines: string[] = [];
        for (const raw of sub.split('\n')) {
          const words = raw.split(' ');
          let cur = '';
          for (const wd of words) {
            const test = cur + wd + ' ';
            if (ctx.measureText(test).width > W * 0.56 && cur) { subLines.push(cur.trim()); cur = wd + ' '; }
            else cur = test;
          }
          if (cur.trim()) subLines.push(cur.trim());
        }
        subLines.slice(0, 2).forEach((line, i) =>
          ctx.fillText(line, pad, subY + i * Math.round(subFs * 1.32)));

        try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0em'; } catch { /* yok say */ }
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';
      }

      const barH = Math.round(H * 0.100);
      const barY = H - barH;

      // Çubuğun üstüne yumuşak geçiş bandı — düz kesik kenar "yapıştırılmış şerit"
      // gibi durduğu için görüntüden çubuğa geçiş yumuşatılıyor.
      const fadeH   = Math.round(barH * 0.6);
      const barFade = ctx.createLinearGradient(0, barY - fadeH, 0, barY);
      barFade.addColorStop(0, 'rgba(4,8,20,0)');
      barFade.addColorStop(1, 'rgba(4,8,20,0.96)');
      ctx.fillStyle = barFade;
      ctx.fillRect(0, barY - fadeH, W, fadeH);

      ctx.fillStyle = 'rgba(4,8,20,0.97)';
      ctx.fillRect(0, barY, W, barH);

      // Aksan çizgisi: düz tam genişlik yerine sağa doğru sönen degrade — daha
      // bilinçli görünür ve logoların altında dikkat dağıtmaz.
      const ruleH    = Math.max(2, Math.round(H * 0.0022));
      const ruleGrad = ctx.createLinearGradient(0, 0, W, 0);
      ruleGrad.addColorStop(0,    'rgba(56,189,248,0.95)');
      ruleGrad.addColorStop(0.45, 'rgba(56,189,248,0.35)');
      ruleGrad.addColorStop(1,    'rgba(56,189,248,0)');
      ctx.fillStyle = ruleGrad;
      ctx.fillRect(0, barY, W, ruleH);

      // Alt çubuk tipografisi
      const setTracking = (v: string) => {
        try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = v; }
        catch { /* desteklenmiyorsa yok say */ }
      };

      const bf1 = Math.round(W * 0.021);
      const bf2 = Math.round(W * 0.0125);
      const bL1 = barY + Math.round(barH * 0.44);
      const bL2 = barY + Math.round(barH * 0.76);

      setTracking('-0.01em');
      ctx.font      = `700 ${bf1}px ${FF}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('crewinjob.com', pad, bL1);

      // Slogan: küçük, harf aralıklı, büyük harf — "mikro tipografi" olarak okunur,
      // önceki doygun mavi düz metinden daha tasarlanmış durur.
      setTracking('0.14em');
      ctx.font      = `600 ${bf2}px ${FF}`;
      ctx.fillStyle = 'rgba(148,197,255,0.70)';
      ctx.fillText('THE RIGHT JOB, THE RIGHT TALENT', pad, bL2);
      setTracking('0em');

      const finalize = () => resolve(canvas.toDataURL('image/png').split(',')[1]);

      const roundRect = (rx: number, ry: number, rw: number, rh: number, rr: number) => {
        ctx.beginPath();
        ctx.moveTo(rx + rr, ry);
        ctx.lineTo(rx + rw - rr, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
        ctx.lineTo(rx + rw, ry + rh - rr);
        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
        ctx.lineTo(rx + rr, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
        ctx.lineTo(rx, ry + rr);
        ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
        ctx.closePath();
      };

      /**
       * Opak arka planlı logodan (ör. IMHFC) arka planı siler.
       *
       * Zemin DÜZ RENK OLMAYABİLİR: IMHFC logosunun arkası açık mavi bir degrade.
       * Tek bir ortalama renkle karşılaştırmak iki hataya yol açıyordu — degradenin
       * uçları "içerik" sayılıp kalıyor, buna karşılık eşiği yükseltince logonun
       * açık gri kafa ikonu "zemin" sayılıp siliniyordu. Bu yüzden kenar boyunca
       * bir renk kümesi örneklenir ve her piksel bu kümeye EN YAKIN mesafesine
       * göre değerlendirilir; böylece degradenin tamamı zemin sayılırken zeminden
       * gerçekten ayrışan açık gri detaylar korunur.
       */
      const stripBackground = (img: HTMLImageElement, minInkDist: number): HTMLCanvasElement => {
        const cached = STRIP_CACHE.get(img.src);
        if (cached) return cached;
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        if (!x) return c;
        try {
          x.drawImage(img, 0, 0);
          const imgData = x.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          const w = c.width, h = c.height;

          // HARD: bir zemin tonuna bu kadar yakınsa tamamen şeffaf
          // SOFT: bu aralıkta alfa kademeli düşer (kenar yumuşatma)
          //
          // Eşikler mürekkebin zemine en yakın mesafesine göre daraltılır; sabit
          // değerler iki uçta da hata veriyordu: dar tutunca IMHFC'nin degrade
          // zemini tam silinmiyor, geniş tutunca beyaz-üstüne-beyaz crewin
          // logosunun mürekkebi de siliniyordu. Üst sınırlar degradeyi kapsar.
          const HARD = Math.min(20, Math.max(4, minInkDist * 0.50));
          const SOFT = Math.min(38, Math.max(8, minInkDist * 0.90));

          // Kenar şeridinden zemin renklerini topla (degradenin tüm tonlarını yakalar).
          // Benzer tonlar tek temsilciye indirgenir ve KAÇ KEZ görüldüğü sayılır.
          //
          // Sıklık sayımı şart: beyaz crewin logosunda kenara taşan birkaç
          // yumuşatma pikseli (252,252,252) palete girip beyaz mürekkebi (255)
          // zemin saydırıyor ve logonun tamamı siliniyordu. Nadir görülen kenar
          // renkleri artık zemin kabul edilmiyor.
          const cols: number[] = [];      // düz dizi: r,g,b üçlüleri
          const hits: number[] = [];
          const MERGE2 = HARD * HARD;
          let sampled = 0;
          const push = (px: number, py: number) => {
            const i = (py * w + px) * 4;
            if (d[i + 3] <= 128) return;
            sampled++;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            for (let k = 0; k < cols.length; k += 3) {
              const dr = r - cols[k], dg = g - cols[k+1], db = b - cols[k+2];
              if (dr*dr + dg*dg + db*db < MERGE2) { hits[k / 3]++; return; }
            }
            cols.push(r, g, b); hits.push(1);
          };
          const stepX = Math.max(1, Math.floor(w / 24));
          const stepY = Math.max(1, Math.floor(h / 24));
          for (let px = 0; px < w; px += stepX) { push(px, 0); push(px, h - 1); }
          for (let py = 0; py < h; py += stepY) { push(0, py); push(w - 1, py); }
          if (!sampled) return c;

          // Kenarın %8'inden azında görülen ton zemin sayılmaz (en az bir ton kalır)
          const minHits = Math.max(2, sampled * 0.08);
          const palette: number[] = [];
          for (let k = 0; k < cols.length; k += 3) {
            if (hits[k / 3] >= minHits) palette.push(cols[k], cols[k+1], cols[k+2]);
          }
          if (!palette.length) {
            let bestK = 0;
            for (let k = 1; k < hits.length; k++) if (hits[k] > hits[bestK]) bestK = k;
            palette.push(cols[bestK*3], cols[bestK*3+1], cols[bestK*3+2]);
          }

          // Karekök alınmaz — kare mesafeler eşiklerin kareleriyle karşılaştırılır.
          const HARD2 = HARD * HARD, SOFT2 = SOFT * SOFT;
          let opaqueLeft = 0, totalPx = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            totalPx++;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            let best2 = Infinity;
            for (let k = 0; k < palette.length; k += 3) {
              const dr = r - palette[k], dg = g - palette[k+1], db = b - palette[k+2];
              const dist2 = dr*dr + dg*dg + db*db;
              if (dist2 < best2) { best2 = dist2; if (best2 < HARD2) break; }
            }
            if (best2 < HARD2) {
              d[i + 3] = 0;
            } else if (best2 < SOFT2) {
              const t = (Math.sqrt(best2) - HARD) / (SOFT - HARD);
              d[i + 3] = Math.round(t * d[i + 3]);
              if (d[i + 3] > 128) opaqueLeft++;
            } else {
              opaqueLeft++;
            }
          }

          // Güvenlik ağı: soyma logoyu yok ettiyse (mürekkep zeminden ayırt
          // edilemeyecek kadar yakın) orijinali kullan. Çirkin bir kutu, görünmez
          // bir logodan iyidir — ve sessizce boş çıktı vermekten kesinlikle iyidir.
          if (totalPx > 0 && opaqueLeft / totalPx < 0.02) {
            x.clearRect(0, 0, w, h);
            x.drawImage(img, 0, 0);
          } else {
            x.putImageData(imgData, 0, 0);
          }
        } catch { /* güvenlik kısıtı — boş canvas döner */ }
        STRIP_CACHE.set(img.src, c);
        return c;
      };

      /**
       * Logoyu alt çubuğa yerleştirir, bir sonraki logonun sağ kenarını döndürür.
       *
       * Logo tipine göre iki sunum:
       *  - Şeffaf zeminli / açık mürekkepli (ör. beyaz crewin) → kapsız, doğrudan
       *    koyu çubuk üstünde.
       *  - Koyu mürekkepli (ör. lacivert yazılı IMHFC) → açık panel üstünde.
       *    Koyu mürekkep koyu çubukta okunmaz; marka renklerini (lacivert yazı,
       *    kırmızı "C", gri ikon) korumak için logoyu açık bir zemine alıyoruz.
       *    Panel yumuşak bir hâle ile çevrelenir — düz beyaz dikdörtgen çubuğa
       *    yapıştırılmış etiket gibi duruyordu, hâle geçişi eritir.
       *
       * Her iki durumda da logonun kendi zemini stripBackground() ile temizlenir;
       * aksi halde IMHFC'nin açık mavi degradesi panelin beyazıyla çakışıyordu.
       */
      const drawLogo = (logo: HTMLImageElement, look: LogoLook, rightEdge: number, maxWRatio: number): number => {
        const { crop } = look;
        const aspect   = crop.w / crop.h;
        // Soyma kararı zemine bakar (opaksa soy), panel kararı mürekkebe.
        const source: HTMLImageElement | HTMLCanvasElement =
          look.bgOpaque ? stripBackground(logo, look.minInkDist) : logo;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (look.needsLightCard) {
          const cardH = Math.round(barH * 0.76);
          const inset = Math.round(cardH * 0.13);
          const logoH = cardH - inset * 2;
          const logoW = Math.min(Math.round(aspect * logoH), Math.round(W * maxWRatio));
          const cardW = logoW + inset * 2;
          const cardX = rightEdge - cardW;
          const cardY = barY + Math.round((barH - cardH) / 2);
          const cardR = Math.round(cardH * 0.20);
          const halo  = Math.round(cardH * 0.10);

          // Yumuşak hâle: panelin sert kenarını çubuğa doğru eritir
          ctx.save();
          ctx.shadowColor  = 'rgba(148,197,255,0.30)';
          ctx.shadowBlur   = Math.round(cardH * 0.55);
          ctx.fillStyle    = 'rgba(255,255,255,0.09)';
          roundRect(cardX - halo, cardY - halo, cardW + halo * 2, cardH + halo * 2, cardR + halo);
          ctx.fill();
          ctx.restore();

          // Panel: saf beyaz koyu zeminde parlıyor — hafif soğuk kırık beyaz daha sakin
          ctx.save();
          ctx.shadowColor   = 'rgba(0,0,0,0.32)';
          ctx.shadowBlur    = Math.round(cardH * 0.20);
          ctx.shadowOffsetY = Math.round(cardH * 0.04);
          ctx.fillStyle     = 'rgba(250,252,255,0.97)';
          roundRect(cardX, cardY, cardW, cardH, cardR);
          ctx.fill();
          ctx.restore();

          ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, cardX + inset, cardY + inset, logoW, logoH);
          return cardX - Math.round(cardH * 0.26);
        }

        // Açık mürekkepli logo — koyu çubuk zaten zemin, kap gerekmez
        const logoH = Math.round(barH * 0.52);
        const logoW = Math.min(Math.round(aspect * logoH), Math.round(W * maxWRatio));
        const logoX = rightEdge - logoW;
        const logoY = barY + Math.round((barH - logoH) / 2);
        ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, logoX, logoY, logoW, logoH);
        return logoX - Math.round(logoH * 0.30);
      };

      const [brandLogo, partnerLogo] = await Promise.all([
        logoBase64        ? loadImage(logoBase64)        : Promise.resolve(null),
        partnerLogoBase64 ? loadImage(partnerLogoBase64) : Promise.resolve(null),
      ]);

      if (brandLogo || partnerLogo) {
        // İki logo varsa her biri daralır — alt çubuktaki metinle çakışmayı önler.
        const maxWRatio = (brandLogo && partnerLogo) ? 0.19 : 0.22;
        let rightEdge = W - pad;

        if (brandLogo) {
          rightEdge = drawLogo(brandLogo, analyzeLogo(brandLogo), rightEdge, maxWRatio);
        }

        if (partnerLogo) {
          if (brandLogo) {
            // Dikey ayraç — işbirliğini gösterir. "×" glifi kalabalık duruyordu;
            // ince çizgi daha sakin ama görünür kalmalı, aksi halde iki logo
            // birbirine yapışık tek bir blok gibi okunuyor.
            const gap  = Math.round(W * 0.018);
            const divH = Math.round(barH * 0.38);
            const divW = Math.max(1, Math.round(W * 0.0018));
            const divX = rightEdge - gap;
            ctx.fillStyle = 'rgba(148,197,255,0.45)';
            ctx.fillRect(divX, barY + Math.round((barH - divH) / 2), divW, divH);
            rightEdge = divX - gap;
          }
          drawLogo(partnerLogo, analyzeLogo(partnerLogo), rightEdge, maxWRatio);
        }
        finalize();
      } else {
        const byLabel = 'by Crewin';
        const byFont  = Math.round(W * 0.019);
        ctx.font      = `600 ${byFont}px ${FF}`;
        ctx.fillStyle = 'rgba(148,210,255,0.50)';
        const byW     = ctx.measureText(byLabel).width;
        ctx.fillText(byLabel, Math.round((W - byW) / 2), barY + Math.round(barH * 0.58));
        finalize();
      }
    };
    bg.onerror = () => resolve(imageBase64);
    bg.src = `data:${imageMime};base64,${imageBase64}`;
  });
}
