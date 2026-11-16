// Minimal ZIP writer (stored entries, no compression): PNG and JPEG are already compressed, so a "stored" archive is
// as small as a deflated one and needs no library. Works in the browser and in Node (tests). UTF-8 names (flag bit 11).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosTime(date: Date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
export function zipStore(files: { name: string; data: Uint8Array }[], at = new Date()): Uint8Array {
  const encoder = new TextEncoder(), { time, date } = dosTime(at), locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const file of files) {
    // Folders are allowed (a/b.png); absolute paths, '..' and characters Windows refuses are not.
    const clean = file.name.replace(/[\\:*?"<>|\u0000-\u001f]/g, '-').split('/').filter(part => part && part !== '.' && part !== '..').join('/') || 'file';
    let name = clean;
    for (let i = 2; seen.has(name); i++) name = clean.replace(/(\.[^./]*)?$/, `-${i}$1`);
    seen.add(name);
    const nameBytes = encoder.encode(name), crc = crc32(file.data), size = file.data.length;
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true); local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46);
    locals.push(local, file.data); centrals.push(central);
    offset += local.length + size;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at2 = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at2); at2 += part.length; }
  return out;
}
