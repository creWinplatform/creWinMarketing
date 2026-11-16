// Short videos from the design studio: each scene is a design drawn once at full size; frames add a slow zoom and a
// cross-fade between scenes. The browser's own H.264 encoder (WebCodecs) encodes them and mp4-writer.ts packs the MP4,
// so nothing is installed and nothing leaves the browser until the person adds the video to a draft.
import { writeMp4, type Mp4Sample } from '@/lib/platform/mp4-writer';
import { projectRequest } from '@/lib/platform/client';

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

export async function encodeVideo(scenes: Scenes, onProgress: (done: number, total: number) => void): Promise<{ bytes: Uint8Array; durationMs: number }> {
  const config = await videoConfig(scenes.w, scenes.h);
  if (!config) throw new Error('unsupported');
  const canvas = document.createElement('canvas'); canvas.width = scenes.w; canvas.height = scenes.h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas');
  const durationMs = videoDuration(scenes), frames = Math.round((durationMs / 1000) * VIDEO_FPS), samples: (Mp4Sample & { ts: number })[] = [];
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
      drawFrame(ctx, scenes, (i * 1000) / VIDEO_FPS);
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
  return { bytes: writeMp4({ width: scenes.w, height: scenes.h, fps: VIDEO_FPS, avcC, samples }), durationMs };
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Uploads in parts (each retried twice), then asks the server to check the whole file; returns the hosted address.
export async function uploadVideo(bytes: Uint8Array, meta: { width: number; height: number; durationMs: number }, onProgress: (sent: number, total: number) => void) {
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
