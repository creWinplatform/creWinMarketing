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

/**
 * Arka plan üzerine profesyonel brand katmanları çizer:
 * gradient overlay → headline → tagline → bottom bar → logo
 * Platform hedef çözünürlüğüne ölçekler, PNG (kayıpsız) döndürür.
 */
export async function compositePostImage(
  imageMime: string,
  imageBase64: string,
  logoBase64: string,
  headline: string,
  platform: string,
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
    bg.onload = () => {
      const [targetW, targetH] = PLATFORM_TARGET[platform] || [1080, 1080];
      const scaleUp = Math.max(1, targetW / bg.width, targetH / bg.height);
      const W = Math.round(bg.width  * scaleUp);
      const H = Math.round(bg.height * scaleUp);
      canvas.width  = W;
      canvas.height = H;

      ctx.drawImage(bg, 0, 0, W, H);

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

      const fontSize = Math.round(W * 0.060);
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
      // Maksimum 4 satır — alt çubukla çakışmayı önler
      const visibleLines = wrappedLines.slice(0, 4);
      visibleLines.forEach((line, i) => ctx.fillText(line, pad, textStartY + i * lineH));
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';

      const barH = Math.round(H * 0.100);
      const barY = H - barH;
      ctx.fillStyle = 'rgba(4,8,20,1.0)';
      ctx.fillRect(0, barY, W, barH);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(0, barY, W, Math.max(2, Math.round(H * 0.003)));

      const bf1 = Math.round(W * 0.022);
      const bf2 = Math.round(W * 0.015);
      const bL1 = barY + Math.round(barH * 0.40);
      const bL2 = barY + Math.round(barH * 0.78);
      ctx.font      = `700 ${bf1}px ${FF}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('crewinjob.com', pad, bL1);
      ctx.font      = `400 ${bf2}px ${FF}`;
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('The Right Job, The Right Talent', pad, bL2);

      const finalize = () => resolve(canvas.toDataURL('image/png').split(',')[1]);

      if (logoBase64) {
        const logo = new Image();
        logo.onload = () => {
          // Logo yüksekliği: bar içine tam sığacak şekilde (taşma önlendi)
          const logoH    = Math.round(barH * 0.72);
          const logoW    = Math.min(Math.round((logo.width / logo.height) * logoH), Math.round(W * 0.20));
          const pillPadX = Math.round(logoW * 0.18);
          const pillPadY = Math.round(barH * 0.14);
          const pillW    = logoW + pillPadX * 2;
          const pillH    = barH;   // pill yüksekliği = bar yüksekliği (tam içinde)
          const pillX    = W - pillW - pad;
          const pillY    = barY;   // bar ile hizalı
          const pillR    = Math.round(Math.min(pillW, pillH) * 0.12);

          // Pill arka planı: koyu navy — hem beyaz hem renkli logolar üstünde görünür
          ctx.shadowColor   = 'rgba(0,0,0,0.40)';
          ctx.shadowBlur    = Math.round(pillH * 0.18);
          ctx.shadowOffsetY = 0;
          ctx.fillStyle     = 'rgba(4,8,20,0.90)';   // koyu navy pill
          ctx.beginPath();
          ctx.moveTo(pillX + pillR, pillY);
          ctx.lineTo(pillX + pillW - pillR, pillY);
          ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
          ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
          ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
          ctx.lineTo(pillX + pillR, pillY + pillH);
          ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
          ctx.lineTo(pillX, pillY + pillR);
          ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
          ctx.closePath();
          ctx.fill();
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
          ctx.strokeStyle = 'rgba(56,189,248,0.45)';  // açık mavi kenarlık
          ctx.lineWidth   = Math.max(1, Math.round(pillH * 0.018));
          ctx.beginPath();
          ctx.moveTo(pillX + pillR, pillY);
          ctx.lineTo(pillX + pillW - pillR, pillY);
          ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
          ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
          ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
          ctx.lineTo(pillX + pillR, pillY + pillH);
          ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
          ctx.lineTo(pillX, pillY + pillR);
          ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
          ctx.closePath();
          ctx.stroke();
          // Logo dikey ortala
          const logoDrawY = pillY + Math.round((pillH - logoH) / 2);
          ctx.drawImage(logo, pillX + pillPadX, logoDrawY, logoW, logoH);
          finalize();
        };
        logo.onerror = finalize;
        logo.src = `data:image/png;base64,${logoBase64}`;
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
