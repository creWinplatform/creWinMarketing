// Minimal MP4 (ISO BMFF) writer for one H.264 video track, as the design studio's short videos need: the browser's
// VideoEncoder gives AVCC samples and the avcC record; this puts them into ftyp + moov + mdat with the moov first
// ("fast start"), so Instagram, TikTok and browsers can start reading before the whole file arrives. No audio, no B-frames
// (samples must arrive in presentation order). Pure: runs in the browser and in Node tests.
export type Mp4Sample = { data: Uint8Array; key: boolean };
export type Mp4Input = { width: number; height: number; fps: number; avcC: Uint8Array; samples: Mp4Sample[] };

const TIMESCALE = 90000;
const enc = new TextEncoder();
function u32(value: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0); return b; }
function u16(value: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value & 0xffff); return b; }
function concat(parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
function box(type: string, ...body: Uint8Array[]) { const content = concat(body); return concat([u32(content.length + 8), enc.encode(type), content]); }
function full(type: string, version: number, flags: number, ...body: Uint8Array[]) { return box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...body); }
const zeros = (n: number) => new Uint8Array(n);
// Identity transformation matrix (16.16 / 2.30 fixed point).
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

export function writeMp4(input: Mp4Input): Uint8Array {
  const { width, height, fps, avcC, samples } = input;
  if (!samples.length) throw new Error('No video samples.');
  if (!samples[0].key) throw new Error('The first sample must be a key frame.');
  if (!(fps > 0 && fps <= 120) || !(width > 0 && height > 0) || width > 8192 || height > 8192) throw new Error('Invalid video size or frame rate.');
  const delta = Math.round(TIMESCALE / fps), duration = delta * samples.length, durationMs = Math.round((duration / TIMESCALE) * 1000);
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
  const moov = (chunkOffset: number) => {
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durationMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durationMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width * 65536), u32(height * 65536));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0'));
    const compressor = zeros(32);
    const avc1 = box('avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), compressor, u16(0x0018), u16(0xffff), box('avcC', avcC));
    const stsd = full('stsd', 0, 0, u32(1), avc1);
    const stts = full('stts', 0, 0, u32(1), u32(samples.length), u32(delta));
    const keys = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
    const stss = full('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map(s => u32(s.data.length)));
    const stco = full('stco', 0, 0, u32(1), u32(chunkOffset));
    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const minf = box('minf', full('vmhd', 0, 1, zeros(8)), dinf, stbl);
    return box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)));
  };
  const mediaBytes = samples.reduce((s, x) => s + x.data.length, 0);
  if (mediaBytes + 8 > 0xffffffff) throw new Error('Video too large.');
  // The moov's size does not depend on the offset value, so measure once and write it with the real offset.
  const offset = ftyp.length + moov(0).length + 8;
  return concat([ftyp, moov(offset), u32(mediaBytes + 8), enc.encode('mdat'), ...samples.map(s => s.data)]);
}

// Reads the top-level boxes and the sample table back (tests and the server's upload check).
export function readMp4(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  const boxes = (from: number, to: number) => { const out: { type: string; start: number; size: number }[] = []; let at = from; while (at + 8 <= to) { const size = view.getUint32(at), type = dec.decode(bytes.subarray(at + 4, at + 8)); if (size < 8 || at + size > to) throw new Error('Broken MP4 box.'); out.push({ type, start: at, size }); at += size; } if (at !== to) throw new Error('Trailing bytes.'); return out; };
  const top = boxes(0, bytes.length), find = (list: { type: string; start: number; size: number }[], type: string) => { const item = list.find(b => b.type === type); if (!item) throw new Error(`Missing ${type}.`); return item; };
  const inside = (b: { start: number; size: number }) => boxes(b.start + 8, b.start + b.size);
  const moov = find(top, 'moov'), trak = find(inside(moov), 'trak'), mdia = find(inside(trak), 'mdia'), stbl = find(inside(find(inside(mdia), 'minf')), 'stbl'), tables = inside(stbl);
  const mdhd = find(inside(mdia), 'mdhd'), timescale = view.getUint32(mdhd.start + 20), duration = view.getUint32(mdhd.start + 24);
  const stsz = find(tables, 'stsz'), count = view.getUint32(stsz.start + 16), stco = find(tables, 'stco'), offset = view.getUint32(stco.start + 16);
  const avc1 = find(tables, 'stsd'), width = view.getUint16(avc1.start + 16 + 8 + 24), height = view.getUint16(avc1.start + 16 + 8 + 26);
  const sizes = Array.from({ length: count }, (_, i) => view.getUint32(stsz.start + 20 + i * 4)), mdat = find(top, 'mdat');
  return { types: top.map(b => b.type), width, height, timescale, duration, count, sizes, offset, mdatStart: mdat.start + 8, mdatEnd: mdat.start + mdat.size };
}
