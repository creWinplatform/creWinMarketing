// "Wjob by crewin" dikey lockup üretici — BEYAZ versiyon (koyu/navy header için).
//
// Kaynak: Wjob işareti markanın GERÇEK dosyasından (Vjob by crewin.png) kesilmiş piksel veri
// (wjob-mark.source.png). Her pikselin RGB'si beyaza çevrilir, orijinal alfa (şeffaflık) korunur
// — böylece siluet aynı kalır, sadece renk beyaza döner.
//
// Yerleşim sabit sayılara değil, ÖLÇÜME dayanır: her parçanın gerçek mürekkep (ink) sınırı
// piksel taramasıyla bulunur, "by" ile "crewin" ortak BASELINE üzerinde hizalanır.
//
// Çalıştırma (sharp crewinjob-web altında):
//   NODE_PATH=../crewinjob-web/node_modules node assets/_build/compose.js
const sharp = require('sharp');
const path = require('path');

const SRC_MARK   = path.join(__dirname, 'wjob-mark.source.png');
const SRC_CREWIN = path.join(__dirname, 'crewin.source.svg');
const OUT        = path.join(__dirname, '..', 'email-logo.png');
const OUT_PREVIEW = path.join(__dirname, '__preview-dark.png'); // görsel doğrulama (koyu zemin)

// crewin.source.svg viewBox: 706.63 × 151.81
const SVG_ASPECT      = 706.63 / 151.81; // ≈ 4.654
const BY_ASCENT_RATIO = 0.88;  // "by" çıkıcı yüksekliği ('b' tepesi) / crewin ink yüksekliği
const GAP_X_RATIO     = 0.040; // "by" ile "crewin" arası boşluk / mark genişliği
const GAP_Y_RATIO     = 0.20;  // mark ile alt satır arası dikey boşluk / mark yüksekliği
const ROW_WIDTH_RATIO = 0.72;  // alt satır ink genişliği / mark genişliği

/** Alfa kanalını tarayarak gerçek mürekkep sınırını bulur. */
async function inkBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('görüntüde mürekkep yok');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Görüntüyü gerçek mürekkep sınırına kırpar. */
async function trimToInk(buf) {
  const box = await inkBox(buf);
  const out = await sharp(buf).extract(box).png().toBuffer();
  return { buf: out, box };
}

/**
 * PNG buffer'daki her pikseli beyaza çevirir.
 * Kaynakta alfa kanalı varsa onu korur. Yoksa (opak beyaz zeminli PNG),
 * alfayı TERS PARLAKLIKTAN türetir: koyu pikseller → opak beyaz, açık → şeffaf.
 */
async function toWhite(pngBuffer) {
  const meta = await sharp(pngBuffer).metadata();
  const hasRealAlpha = meta.hasAlpha;
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (!hasRealAlpha) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i + 3] = luminance < 230 ? 255 : 0;
    }
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * "by" metnini büyük ölçekte render edip ink metriklerini ölçer.
 * Sabit tahmin yerine gerçek yazı tipi metriği kullanılır — Arial'de "by" ink genişliği
 * ~0.98 em'dir (eski koddaki 2.40 em varsayımı 2.4 kat fazlaydı).
 * @returns {{ buf: Buffer, w: number, h: number, ascent: number, descent: number }}
 *          ascent = baseline'ın üstündeki, descent = altındaki mürekkep yüksekliği
 */
async function measureBy() {
  const F = 400, BASE = 600;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
    <text x="50" y="${BASE}" font-family="Arial, Helvetica, sans-serif" font-size="${F}" font-weight="400" fill="#ffffff">by</text>
  </svg>`;
  const raw = await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
  const { buf, box } = await trimToInk(raw);
  return { buf, w: box.width, h: box.height, ascent: BASE - box.top, descent: (box.top + box.height) - BASE };
}

async function main() {
  // 1. Wjob işareti — beyaza çevir, ink sınırına kırp
  const markRaw = await sharp(SRC_MARK).png().toBuffer();
  const { buf: mark, box: markBox } = await trimToInk(await toWhite(markRaw));
  const W = markBox.width;

  // 2. "by" ink metriklerini ölç (ölçek bağımsız oranlar)
  const byRef   = await measureBy();
  const byWPerA = byRef.w / byRef.ascent;        // ink genişliği / çıkıcı yüksekliği
  const byHPerA = byRef.h / byRef.ascent;
  const byDPerA = byRef.descent / byRef.ascent;  // inici ('y' kuyruğu) / çıkıcı

  // 3. crewin genişliğini çöz — alt satırın toplam ink genişliği W * ROW_WIDTH_RATIO olsun.
  //    crewinH  = crewinW / SVG_ASPECT
  //    byAscent = crewinH * BY_ASCENT_RATIO
  //    byW      = byAscent * byWPerA
  //    rowW     = byW + gapX + crewinW
  const gapX    = Math.round(W * GAP_X_RATIO);
  const K       = (BY_ASCENT_RATIO * byWPerA) / SVG_ASPECT;
  const crewinW = Math.round((W * ROW_WIDTH_RATIO - gapX) / (1 + K));

  const crewinRaw = await sharp(SRC_CREWIN, { density: 900 }).resize({ width: crewinW }).png().toBuffer();
  const { buf: crewin, box: crewinBox } = await trimToInk(await toWhite(crewinRaw));
  const crewinH = crewinBox.height;

  // 4. "by"yi hedef boyuta ölçekle
  const byAscent  = Math.round(crewinH * BY_ASCENT_RATIO);
  const byW       = Math.max(1, Math.round(byAscent * byWPerA));
  const byH       = Math.max(1, Math.round(byAscent * byHPerA));
  const byDescent = Math.round(byAscent * byDPerA);
  const by = await sharp(byRef.buf).resize({ width: byW, height: byH, fit: 'fill' }).png().toBuffer();

  // 5. Alt satır — ORTAK BASELINE üzerinde hizala.
  //    "crewin" küçük harflerden oluşur, inici harfi yoktur → ink alt kenarı = baseline.
  //    "by"de 'y' kuyruğu baseline'ın altına taşar; bu yüzden satır yüksekliği descent kadar artar.
  const baseline = Math.max(crewinH, byAscent);
  const rowH     = baseline + Math.max(0, byDescent);
  const rowW     = byW + gapX + crewinBox.width;
  const row = await sharp({
    create: { width: rowW, height: rowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: by,     left: 0,          top: baseline - byAscent },
      { input: crewin, left: byW + gapX, top: baseline - crewinH  },
    ])
    .png()
    .toBuffer();

  // 6. Nihai tuval — mark üstte ortada, alt satır hemen altında ortada
  const gapY    = Math.round(markBox.height * GAP_Y_RATIO);
  const canvasW = Math.max(markBox.width, rowW);
  const canvasH = markBox.height + gapY + rowH;

  const composite = [
    { input: mark, left: Math.round((canvasW - markBox.width) / 2), top: 0 },
    { input: row,  left: Math.round((canvasW - rowW)          / 2), top: markBox.height + gapY },
  ];

  await sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composite).png().toFile(OUT);

  // 7. Görsel doğrulama kopyası — beyaz logo şeffaf zeminde görünmez, koyu zemine bas
  await sharp({
    create: { width: canvasW + 120, height: canvasH + 120, channels: 4, background: { r: 15, g: 86, b: 113, alpha: 1 } },
  })
    .composite([{ input: await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite(composite).png().toBuffer(), left: 60, top: 60 }])
    .png()
    .toFile(OUT_PREVIEW);

  console.log(`COMPOSED (white) ${canvasW}x${canvasH}`);
  console.log(`  mark      = ${W}x${markBox.height}`);
  console.log(`  crewin    = ${crewinBox.width}x${crewinH}`);
  console.log(`  by        = ${byW}x${byH}  (ascent=${byAscent} descent=${byDescent})`);
  console.log(`  row       = ${rowW}x${rowH}  (mark'ın %${(rowW / W * 100).toFixed(1)}'i)`);
  console.log(`  gapX=${gapX} gapY=${gapY} baseline=${baseline}`);
  console.log(`  ölçülen "by": inkW/ascent=${byWPerA.toFixed(3)} (eski kod 2.40 em varsayıyordu)`);
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
