// Short videos from the design studio. A timeline of scenes: designs (drawn once at full size, with a slow zoom and a
// cross-fade into the next design) and the person's own clips (trimmed, with an optional caption and the logo). The
// browser's own encoders (WebCodecs: H.264 video, AAC audio when available) encode them and mp4-writer.ts packs the
// MP4, so nothing is installed and nothing leaves the browser until the person adds the video to a draft.
import { writeMp4, type Mp4Audio, type Mp4Sample } from '@/lib/platform/mp4-writer';
import { projectRequest } from '@/lib/platform/client';
import { fit } from '@/lib/platform/design-layout';

export const VIDEO_FPS = 30;
export const FADE_MS = 450;
export type Scenes = { images: CanvasImageSource[]; w: number; h: number; sceneMs: number };
// A user-facing message (server answers); other errors show a generic text.
export class StudioError extends Error {}
export const videoDuration = (scenes: { images: { length: number }; sceneMs: number }) => scenes.images.length === 1 ? Math.max(scenes.sceneMs, 4000) : scenes.images.length * scenes.sceneMs;

export function videoSupported() {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}
// H.264 profiles in order of preference; level 4.0 covers 1080×1920.
export async function videoConfig(w: number, h: number): Promise<VideoEncoderConfig | null> {
  if (!videoSupported()) return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033']) {
    const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate: 6_000_000, framerate: VIDEO_FPS, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* try the next profile */ }
  }
  return null;
}
// Draws the frame at time t (ms): the current scene with a slow zoom, and the next one fading in near the end.
export function drawFrame(ctx: CanvasRenderingContext2D, scenes: Scenes, t: number, scale = 1) {
  const { images, w, h, sceneMs } = scenes, total = videoDuration(scenes), single = images.length === 1;
  const span = single ? total : sceneMs, index = single ? 0 : Math.min(images.length - 1, Math.floor(t / sceneMs)), local = single ? t : t - index * sceneMs;
  const zoom = (progress: number) => 1 + 0.045 * Math.min(1, Math.max(0, progress));
  const put = (image: CanvasImageSource, z: number, alpha: number) => { ctx.globalAlpha = alpha; ctx.drawImage(image, (-(z - 1) * w / 2) * scale, (-(z - 1) * h / 2) * scale, w * z * scale, h * z * scale); };
  put(images[index], zoom(local / span), 1);
  if (!single && index < images.length - 1 && local > sceneMs - FADE_MS) put(images[index + 1], 1, (local - (sceneMs - FADE_MS)) / FADE_MS);
  ctx.globalAlpha = 1;
}

// Template designs only (the studio's own preview and the simple "designs as a video" case).
export async function encodeVideo(scenes: Scenes, onProgress: (done: number, total: number) => void, audio?: TimelineAudio) {
  const single = scenes.images.length === 1;
  return await encodeTimeline({ w: scenes.w, h: scenes.h, scenes: scenes.images.map(image => ({ kind: 'image' as const, image, ms: single ? Math.max(scenes.sceneMs, 4000) : scenes.sceneMs })), audio }, onProgress);
}

export type TimelineScene = { kind: 'image'; image: CanvasImageSource; ms: number } | { kind: 'clip'; video: HTMLVideoElement; start: number; ms: number; caption: string; audio: AudioBuffer | null };
// aiVoiceover: the sound includes an AI-generated voiceover (voice features, later; nothing sets it yet). It is carried
// into the export metadata so the person is reminded to turn on the AI content label when sharing.
export type TimelineAudio = { clipVolume: number; music: AudioBuffer | null; musicVolume: number; aiVoiceover?: boolean };
export type Timeline = { w: number; h: number; scenes: TimelineScene[]; audio?: TimelineAudio; overlay?: { font: string; logo: HTMLImageElement | null } };
export const timelineMs = (timeline: { scenes: { ms: number }[] }) => timeline.scenes.reduce((sum, scene) => sum + scene.ms, 0);

// Moves a clip to a time and waits until that frame is ready to draw (at most 3 s).
async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return;
  await new Promise<void>(resolve => { const done = () => { video.removeEventListener('seeked', done); clearTimeout(timer); resolve(); }; const timer = setTimeout(done, 3000); video.addEventListener('seeked', done); video.currentTime = time; });
}
function cover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, w: number, h: number) {
  if (!sw || !sh) return; const s = Math.max(w / sw, h / sh), cw = w / s, ch = h / s; ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
}
// A clip frame: the picture filling the canvas, the caption on a dark band near the bottom, the logo top left.
function drawClipOverlay(ctx: CanvasRenderingContext2D, timeline: Timeline, caption: string) {
  const { w, h } = timeline, u = Math.min(w, h), font = timeline.overlay?.font || 'sans-serif';
  if (caption.trim()) {
    const measure = (value: string, f: string) => { ctx.font = f; return ctx.measureText(value).width; };
    const box = { w: w * 0.84, h: h * 0.16 }, size = fit(caption, box, { max: u * 0.07, min: u * 0.035, weight: 800, family: font, maxLines: 3, lineHeight: 1.15 }, measure);
    const bandH = size.height + u * 0.06, top = h * 0.8 - bandH / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, top, w, bandH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = `800 ${size.size}px ${font}`;
    size.lines.forEach((line, i) => ctx.fillText(line, w / 2, top + u * 0.03 + i * size.size * 1.15));
  }
  const logo = timeline.overlay?.logo;
  if (logo?.naturalWidth) { const lh = u * 0.08, lw = Math.min(u * 0.3, (logo.naturalWidth / logo.naturalHeight) * lh); ctx.globalAlpha = 0.92; ctx.drawImage(logo, u * 0.05, u * 0.05, lw, lh); ctx.globalAlpha = 1; }
}
export async function drawTimelineFrame(ctx: CanvasRenderingContext2D, timeline: Timeline, t: number) {
  const { w, h, scenes } = timeline;
  let start = 0, index = 0;
  while (index < scenes.length - 1 && t >= start + scenes[index].ms) { start += scenes[index].ms; index++; }
  const scene = scenes[index], local = t - start, zoom = (p: number) => 1 + 0.045 * Math.min(1, Math.max(0, p));
  const put = (image: CanvasImageSource, z: number, alpha: number) => { ctx.globalAlpha = alpha; ctx.drawImage(image, -(z - 1) * w / 2, -(z - 1) * h / 2, w * z, h * z); ctx.globalAlpha = 1; };
  if (scene.kind === 'image') {
    put(scene.image, zoom(local / scene.ms), 1);
    const next = scenes[index + 1];
    if (next?.kind === 'image' && local > scene.ms - FADE_MS) put(next.image, 1, (local - (scene.ms - FADE_MS)) / FADE_MS);
  } else {
    await seek(scene.video, Math.min(scene.start + local / 1000, Math.max(0, scene.video.duration - 0.05)));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    cover(ctx, scene.video, scene.video.videoWidth, scene.video.videoHeight, w, h);
    drawClipOverlay(ctx, timeline, scene.caption);
  }
}

// The sound: each clip's own audio at its place on the timeline, and the music looped under everything, fading out
// over the last 1.5 s. Mixed offline at 48 kHz stereo; null when there is nothing to hear.
export async function mixAudio(timeline: Timeline): Promise<AudioBuffer | null> {
  const audio = timeline.audio, total = timelineMs(timeline) / 1000;
  if (!audio || !(total > 0)) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * 48000), 48000);
  // A limiter on the master bus keeps clip sound plus music from clipping (distortion) when both are loud.
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -6; master.knee.value = 6; master.ratio.value = 12; master.attack.value = 0.003; master.release.value = 0.25;
  master.connect(ctx.destination);
  let any = false, at = 0;
  for (const scene of timeline.scenes) {
    if (scene.kind === 'clip' && scene.audio && audio.clipVolume > 0) {
      const source = ctx.createBufferSource(), gain = ctx.createGain(); source.buffer = scene.audio; gain.gain.value = audio.clipVolume;
      source.connect(gain).connect(master); source.start(at / 1000, scene.start, scene.ms / 1000); any = true;
    }
    at += scene.ms;
  }
  if (audio.music && audio.musicVolume > 0) {
    const source = ctx.createBufferSource(), gain = ctx.createGain(); source.buffer = audio.music; source.loop = true;
    gain.gain.setValueAtTime(audio.musicVolume, 0); gain.gain.setValueAtTime(audio.musicVolume, Math.max(0, total - 1.5)); gain.gain.linearRampToValueAtTime(0, total);
    source.connect(gain).connect(master); source.start(0); source.stop(total); any = true;
  }
  return any ? await ctx.startRendering() : null;
}
export async function aacSupported() {
  if (typeof window === 'undefined' || !('AudioEncoder' in window)) return false;
  try { return Boolean((await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported); } catch { return false; }
}
// AAC-LC frames (1024 samples each) and the AudioSpecificConfig, ready for mp4-writer.
async function encodeAudio(buffer: AudioBuffer): Promise<Mp4Audio | null> {
  if (!await aacSupported()) return null;
  const chunks: Uint8Array[] = []; let asc: Uint8Array | null = null, failure: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push(data); const d = meta?.decoderConfig?.description; if (d && !asc) asc = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength)); }, error: error => { failure = error; } });
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
  const left = buffer.getChannelData(0), right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  try {
    for (let at = 0; at < buffer.length; at += 1024) {
      if (failure) throw failure;
      const n = Math.min(1024, buffer.length - at), planes = new Float32Array(n * 2); planes.set(left.subarray(at, at + n), 0); planes.set(right.subarray(at, at + n), n);
      const data = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / 48000) * 1e6), data: planes });
      encoder.encode(data); data.close();
      while (encoder.encodeQueueSize > 20) await new Promise(resolve => setTimeout(resolve, 2));
    }
    await encoder.flush();
  } finally { if (encoder.state !== 'closed') encoder.close(); }
  if (failure) throw failure;
  if (!asc || !chunks.length) return null;
  // The encoder's ASC may describe HE-AAC or carry no explicit length; the writer only needs the bytes as given.
  return { sampleRate: 48000, channels: 2, asc, samples: chunks, bitrate: 128000 };
}

export async function encodeTimeline(timeline: Timeline, onProgress: (done: number, total: number) => void): Promise<{ bytes: Uint8Array; durationMs: number; hasAudio: boolean; aiVoiceover?: true }> {
  const durationMs = timelineMs(timeline);
  if (!(durationMs > 0)) throw new Error('empty');
  const config = await videoConfig(timeline.w, timeline.h);
  if (!config) throw new Error('unsupported');
  // Long videos get a lower bitrate so the file stays under the 50 MB upload limit.
  config.bitrate = Math.min(6_000_000, Math.floor((44 * 8 * 1024 * 1024) / (durationMs / 1000)));
  const canvas = document.createElement('canvas'); canvas.width = timeline.w; canvas.height = timeline.h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas');
  const frames = Math.round((durationMs / 1000) * VIDEO_FPS), samples: (Mp4Sample & { ts: number })[] = [];
  let avcC: Uint8Array | null = null, failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
      const description = meta?.decoderConfig?.description;
      if (description && !avcC) avcC = description instanceof ArrayBuffer ? new Uint8Array(description.slice(0)) : new Uint8Array((description as ArrayBufferView).buffer.slice((description as ArrayBufferView).byteOffset, (description as ArrayBufferView).byteOffset + (description as ArrayBufferView).byteLength));
    },
    error: error => { failure = error; },
  });
  encoder.configure(config);
  try {
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      await drawTimelineFrame(ctx, timeline, (i * 1000) / VIDEO_FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
      encoder.encode(frame, { keyFrame: i % (VIDEO_FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise(resolve => setTimeout(resolve, 4));
      if (i % 10 === 0) { onProgress(i, frames); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    await encoder.flush();
  } finally { if (encoder.state !== 'closed') encoder.close(); canvas.width = canvas.height = 1; }
  if (failure) throw failure;
  onProgress(frames, frames);
  if (!avcC || !samples.length) throw new Error('encoder');
  if (samples.some((sample, i) => i > 0 && sample.ts <= samples[i - 1].ts)) throw new Error('reordered');
  const mixed = await mixAudio(timeline), audio = mixed ? await encodeAudio(mixed) : null;
  return { bytes: writeMp4({ width: timeline.w, height: timeline.h, fps: VIDEO_FPS, avcC, samples, ...(audio ? { audio } : {}) }), durationMs, hasAudio: Boolean(audio), ...(timeline.audio?.aiVoiceover ? { aiVoiceover: true as const } : {}) };
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Uploads in parts (each retried twice), then asks the server to check the whole file; returns the hosted address.
export async function uploadVideo(bytes: Uint8Array, meta: { width: number; height: number; durationMs: number; aiVoiceover?: true }, onProgress: (sent: number, total: number) => void) {
  const server = async <T,>(work: () => Promise<T>) => { try { return await work(); } catch (reason) { throw new StudioError(reason instanceof Error && reason.message ? reason.message : 'Video yüklenemedi.'); } };
  const started = await server(async () => await projectRequest<{ id: string; parts: number; partBytes: number }>('/api/platform/media/videos', { method: 'POST', body: JSON.stringify({ bytes: bytes.length, sha256: await sha256Hex(bytes), ...meta }) }));
  for (let part = 0; part < started.parts; part++) {
    const slice = bytes.subarray(part * started.partBytes, Math.min(bytes.length, (part + 1) * started.partBytes));
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`/api/platform/media/videos/${started.id}?part=${part}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: slice as BodyInit, cache: 'no-store' }).catch(() => null);
      if (response?.ok) break;
      if (attempt >= 2 || (response && response.status < 500 && response.status !== 408 && response.status !== 429)) { let message = ''; try { message = (await response?.json())?.error || ''; } catch { /* no body */ } throw new StudioError(message || 'Video yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.'); }
      await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    }
    onProgress(part + 1, started.parts);
  }
  return await server(async () => await projectRequest<{ id: string; url: string }>(`/api/platform/media/videos/${started.id}`, { method: 'POST', body: JSON.stringify({ action: 'finish' }) }));
}
