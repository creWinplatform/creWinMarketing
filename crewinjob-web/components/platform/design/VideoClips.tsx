'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Film, Loader2, Music, Plus, Trash2, Upload } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { StudioError, aacSupported, encodeTimeline, timelineMs, uploadVideo, videoSupported, type TimelineScene } from './video';
import { projectRequest } from '@/lib/platform/client';
import type { MusicTrack } from '@/lib/platform/music-library';
import { saveFile } from './render';

type Clip = { id: string; name: string; url: string; video: HTMLVideoElement; duration: number; start: number; ms: number; caption: string; audio: AudioBuffer | null; thumb: string };
const MAX_CLIPS = 6, MAX_TOTAL_MS = 90_000, BRAND_SCENE_MS = 2500;
async function decodeAudio(file: File | ArrayBuffer): Promise<AudioBuffer | null> {
  try { return await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(file instanceof ArrayBuffer ? file : await file.arrayBuffer()); } catch { return null; }
}
async function openClip(file: File): Promise<Clip> {
  const url = URL.createObjectURL(file), video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('video')); setTimeout(() => reject(new Error('video')), 15000); });
  await new Promise<void>(resolve => { const done = () => { video.removeEventListener('seeked', done); resolve(); }; video.addEventListener('seeked', done); video.currentTime = Math.min(0.1, video.duration / 2); setTimeout(done, 3000); });
  const canvas = document.createElement('canvas'), ratio = video.videoWidth / video.videoHeight || 1; canvas.width = 96; canvas.height = Math.round(96 / ratio);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  return { id: Math.random().toString(36).slice(2), name: file.name.slice(0, 60), url, video, duration, start: 0, ms: Math.round(Math.min(duration, 10) * 1000), caption: '', audio: await decodeAudio(file), thumb: canvas.toDataURL('image/jpeg', 0.7) };
}

// The person's own clips (trimmed, captioned, reordered), the brand designs before and after them, the clips' sound
// and optional music they hold the rights to. The result is checked as a real MP4 with sound before it goes anywhere.
export default function VideoClips({ lang, size, designs, designCount, sceneMs, overlay, onUseVideo, onError }: {
  lang: Locale; size: { w: number; h: number }; designs: () => HTMLCanvasElement[]; designCount: number; sceneMs: number;
  overlay: { font: string; logo: HTMLImageElement | null }; onUseVideo?: (video: { url: string }) => void; onError: (message: string) => void;
}) {
  const tr = lang === 'tr';
  const [clips, setClips] = useState<Clip[]>([]), [brandScenes, setBrandScenes] = useState(true), [clipVolume, setClipVolume] = useState(100);
  const [music, setMusic] = useState<{ name: string; buffer: AudioBuffer; license?: string } | null>(null), [musicVolume, setMusicVolume] = useState(60), [rights, setRights] = useState(false);
  const [tracks, setTracks] = useState<MusicTrack[]>([]), [trackId, setTrackId] = useState('');
  useEffect(() => { projectRequest<{ tracks: MusicTrack[] }>('/api/platform/music').then(value => { setTracks(value.tracks); setTrackId(value.tracks[0]?.id || ''); }).catch(() => setTracks([])); }, []);
  // A library track is covered by Ryzevo's licence, so it needs no rights tick of its own.
  const useTrack = () => run('music', async () => {
    const track = tracks.find(item => item.id === trackId); if (!track) return;
    const response = await fetch(`/api/platform/music/${track.id}`, { cache: 'force-cache' }); if (!response.ok) throw new StudioError(tr ? 'Parça yüklenemedi.' : 'The track could not be loaded.');
    const buffer = await decodeAudio(await response.arrayBuffer()); if (!buffer) throw new StudioError(tr ? 'Parça okunamadı.' : 'The track could not be read.');
    setMusic({ name: `${track.title} — ${track.artist}`, buffer, license: track.license }); setRights(true); setResult(null);
  });
  const [busy, setBusy] = useState(''), [progress, setProgress] = useState(''), [result, setResult] = useState<{ bytes: Uint8Array; url: string; durationMs: number; hasAudio: boolean } | null>(null), [aac, setAac] = useState(true);
  const clipsRef = useRef(clips); clipsRef.current = clips;
  useEffect(() => { void aacSupported().then(setAac); return () => { for (const clip of clipsRef.current) URL.revokeObjectURL(clip.url); }; }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  const update = (id: string, patch: Partial<Clip>) => { setClips(list => list.map(clip => clip.id === id ? { ...clip, ...patch } : clip)); setResult(null); };
  const move = (index: number, by: number) => { setClips(list => { const next = [...list], [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next; }); setResult(null); };
  const scenes = (): TimelineScene[] => {
    const art = designs(), image = (canvas: HTMLCanvasElement, ms: number) => ({ kind: 'image' as const, image: canvas, ms });
    if (!clips.length) return art.map(canvas => image(canvas, art.length === 1 ? Math.max(sceneMs, 4000) : sceneMs));
    const own = clips.map(clip => ({ kind: 'clip' as const, video: clip.video, start: clip.start, ms: clip.ms, caption: clip.caption, audio: clip.audio }));
    return brandScenes && art.length ? [image(art[0], BRAND_SCENE_MS), ...own, ...(art.length > 1 ? [image(art[art.length - 1], BRAND_SCENE_MS)] : [])] : own;
  };
  // The closing design is added only when there is one besides the cover (as in scenes()).
  const totalMs = clips.length ? clips.reduce((sum, clip) => sum + clip.ms, 0) + (brandScenes && designCount ? BRAND_SCENE_MS * (designCount > 1 ? 2 : 1) : 0) : 0;
  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return; setBusy(key); onError('');
    try { await work(); } catch (reason) {
      setProgress('');
      onError(reason instanceof StudioError ? reason.message : reason instanceof Error && reason.message === 'unsupported' ? (tr ? 'Bu tarayıcı video oluşturmayı desteklemiyor. Chrome, Edge veya güncel Safari kullanın.' : 'This browser cannot create videos. Use Chrome, Edge or a recent Safari.') : (tr ? 'Video hazırlanamadı. Tekrar deneyin.' : 'The video could not be prepared. Try again.'));
    } finally { setBusy(''); }
  };
  const addClips = (files: File[]) => run('clips', async () => {
    const room = MAX_CLIPS - clips.length, chosen = files.filter(file => file.type.startsWith('video/') && file.size <= 400 * 1024 * 1024).slice(0, room);
    if (!chosen.length) { onError(tr ? `En çok ${MAX_CLIPS} klip, her biri en fazla 400 MB video dosyası seçin.` : `Choose up to ${MAX_CLIPS} clips, each a video file of at most 400 MB.`); return; }
    const opened: Clip[] = [];
    for (const [index, file] of chosen.entries()) { setProgress(tr ? `Klip okunuyor: ${index + 1}/${chosen.length}` : `Reading clip ${index + 1}/${chosen.length}`); try { opened.push(await openClip(file)); } catch { onError(tr ? `${file.name} açılamadı (bu tarayıcının okuyamadığı bir biçim olabilir).` : `${file.name} could not be opened (this browser may not read that format).`); } }
    setProgress(''); setClips(list => [...list, ...opened]); setResult(null);
  });
  const pickMusic = (file: File | undefined) => file && run('music', async () => {
    if (!file.type.startsWith('audio/') || file.size > 60 * 1024 * 1024) { onError(tr ? 'En fazla 60 MB bir ses dosyası seçin.' : 'Choose an audio file of at most 60 MB.'); return; }
    const buffer = await decodeAudio(file);
    if (!buffer) { onError(tr ? 'Ses dosyası okunamadı.' : 'The audio file could not be read.'); return; }
    setMusic({ name: file.name.slice(0, 60), buffer }); setRights(false); setResult(null);
  });
  const build = () => run('build', async () => {
    const value = await encodeTimeline({ ...size, scenes: scenes(), overlay, audio: { clipVolume: clipVolume / 100, music: music?.buffer || null, musicVolume: musicVolume / 100 } }, (done, total) => setProgress(tr ? `Video hazırlanıyor: %${Math.round((done / total) * 100)}` : `Making the video: ${Math.round((done / total) * 100)}%`));
    setProgress(''); setResult({ ...value, url: URL.createObjectURL(new Blob([value.bytes as BlobPart], { type: 'video/mp4' })) });
  });
  const add = () => result && run('upload', async () => {
    const value = await uploadVideo(result.bytes, { width: size.w, height: size.h, durationMs: result.durationMs }, (sent, total) => setProgress(tr ? `Yükleniyor: %${Math.round((sent / total) * 100)}` : `Uploading: ${Math.round((sent / total) * 100)}%`));
    setProgress(''); onUseVideo?.({ url: value.url });
  });
  const tooLong = totalMs > MAX_TOTAL_MS, needsRights = Boolean(music) && !music?.license && !rights, seconds = (ms: number) => Math.round(ms / 100) / 10;
  return (
    <section className="video-clips" aria-labelledby="video-clips-title">
      <h3 id="video-clips-title" className="design-fieldset-title"><Film size={15} aria-hidden="true" />{tr ? 'Klipler ve ses' : 'Clips and sound'}</h3>
      <p className="studio-note">{tr ? 'Kendi çektiğiniz klipleri ekleyin; kırpın, sıralayın, alt yazı yazın. Klip eklemezseniz video yalnız tasarımlardan oluşur.' : 'Add clips you shot; trim, reorder and caption them. Without clips the video is made of the designs only.'}</p>
      <label className="studio-secondary design-file">{busy === 'clips' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}{tr ? `Klip ekle (en çok ${MAX_CLIPS})` : `Add clips (up to ${MAX_CLIPS})`}<input type="file" accept="video/*" multiple disabled={Boolean(busy) || clips.length >= MAX_CLIPS} onChange={event => { void addClips(Array.from(event.target.files || [])); event.target.value = ''; }} /></label>
      {clips.length > 0 && <ol className="video-clip-list">{clips.map((clip, index) => <li key={clip.id} className="video-clip">
        <img src={clip.thumb} alt="" className="video-clip-thumb" />
        <div className="video-clip-fields">
          <b className="video-clip-name">{index + 1}. {clip.name}<span className="studio-note"> · {seconds(clip.duration * 1000)} sn{clip.audio ? '' : (tr ? ' · sessiz' : ' · silent')}</span></b>
          <div className="video-clip-times">
            <label>{tr ? 'Başlangıç (sn)' : 'Start (s)'}<input type="number" min={0} max={Math.max(0, Math.floor(clip.duration * 10) / 10 - 0.5)} step={0.1} value={clip.start} onChange={event => { const start = Math.max(0, Math.min(Number(event.target.value) || 0, clip.duration - 0.5)); update(clip.id, { start, ms: Math.min(clip.ms, Math.round((clip.duration - start) * 1000)) }); }} /></label>
            <label>{tr ? 'Süre (sn)' : 'Length (s)'}<input type="number" min={0.5} max={Math.min(60, Math.floor((clip.duration - clip.start) * 10) / 10)} step={0.1} value={seconds(clip.ms)} onChange={event => update(clip.id, { ms: Math.round(Math.max(0.5, Math.min(Number(event.target.value) || 0.5, 60, clip.duration - clip.start)) * 1000) })} /></label>
          </div>
          <label className="video-clip-caption">{tr ? 'Alt yazı (isteğe bağlı)' : 'Caption (optional)'}<input maxLength={90} value={clip.caption} onChange={event => update(clip.id, { caption: event.target.value })} /></label>
        </div>
        <div className="video-clip-actions">
          <button type="button" className="icon-button" disabled={index === 0 || Boolean(busy)} aria-label={tr ? 'Öne taşı' : 'Move earlier'} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" disabled={index === clips.length - 1 || Boolean(busy)} aria-label={tr ? 'Sona taşı' : 'Move later'} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={tr ? 'Klibi kaldır' : 'Remove clip'} onClick={() => { URL.revokeObjectURL(clip.url); setClips(list => list.filter(item => item.id !== clip.id)); setResult(null); }}><Trash2 size={16} /></button>
        </div>
      </li>)}</ol>}
      {clips.length > 0 && <label className="design-toggle"><input type="checkbox" checked={brandScenes} onChange={event => { setBrandScenes(event.target.checked); setResult(null); }} />{designCount > 1 ? (tr ? 'Başa kapak, sona kapanış tasarımı ekle (2,5 sn)' : 'Add the cover design first and the closing design last (2.5 s)') : (tr ? 'Başa kapak tasarımı ekle (2,5 sn; sona kapanış için yukarıya madde yazın)' : 'Add the cover design first (2.5 s; write points above for a closing design)')}</label>}
      <div className="video-sound">
        {clips.some(clip => clip.audio) && <label className="video-range">{tr ? 'Kliplerin sesi' : 'Clip sound'} <output>%{clipVolume}</output><input type="range" min={0} max={100} value={clipVolume} onChange={event => { setClipVolume(Number(event.target.value)); setResult(null); }} /></label>}
        {tracks.length > 0 && <div className="video-library">
          <label className="design-select">{tr ? 'Lisanslı müzik kütüphanesi' : 'Licensed music library'}<select value={trackId} onChange={event => setTrackId(event.target.value)}>{tracks.map(track => <option key={track.id} value={track.id}>{track.title} — {track.artist} · {track.mood}{track.durationMs ? ` · ${seconds(track.durationMs)} sn` : ''}</option>)}</select></label>
          {trackId && <audio controls preload="none" src={`/api/platform/music/${trackId}`} className="video-library-player" aria-label={tr ? 'Parçayı dinle' : 'Listen to the track'} />}
          <button type="button" className="studio-secondary" disabled={Boolean(busy) || !trackId} onClick={useTrack}>{busy === 'music' ? <Loader2 size={15} className="animate-spin" /> : <Music size={15} />}{tr ? 'Bu parçayı kullan' : 'Use this track'}</button>
        </div>}
        <label className="studio-secondary design-file">{busy === 'music' ? <Loader2 size={15} className="animate-spin" /> : <Music size={15} />}{music ? (tr ? 'Kendi müziğimi yükle' : 'Upload my own music') : (tr ? 'Kendi müziğimi ekle (isteğe bağlı)' : 'Add my own music (optional)')}<input type="file" accept="audio/*" disabled={Boolean(busy)} onChange={event => { void pickMusic(event.target.files?.[0]); event.target.value = ''; }} /></label>
        {music && <>
          <p className="studio-note">{music.name} · {seconds(music.buffer.duration * 1000)} sn <button type="button" className="studio-text-button" onClick={() => { setMusic(null); setResult(null); }}>{tr ? 'Kaldır' : 'Remove'}</button></p>
          <label className="video-range">{tr ? 'Müzik sesi' : 'Music volume'} <output>%{musicVolume}</output><input type="range" min={0} max={100} value={musicVolume} onChange={event => { setMusicVolume(Number(event.target.value)); setResult(null); }} /></label>
          {music.license ? <p className="studio-note">{tr ? 'Lisans' : 'Licence'}: {music.license}</p> : <label className="design-toggle"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />{tr ? 'Bu müziği reklam ve sosyal medyada kullanma hakkım var (telifsiz veya lisanslı).' : 'I have the right to use this music in ads and social media (royalty-free or licensed).'}</label>}
        </>}
        {!aac && (music || clips.some(clip => clip.audio)) && <p className="studio-note">{tr ? 'Bu tarayıcı AAC ses kodlamıyor; video sessiz olur. Sesli video için Chrome veya Edge kullanın.' : 'This browser cannot encode AAC sound; the video will be silent. Use Chrome or Edge for sound.'}</p>}
      </div>
      {clips.length > 0 && <p className={tooLong ? 'studio-error' : 'studio-note'}>{tr ? `Toplam ${seconds(totalMs)} sn` : `Total ${seconds(totalMs)} s`}{tooLong ? (tr ? ' — en çok 90 saniye olabilir; klipleri kısaltın.' : ' — at most 90 seconds; shorten the clips.') : ''}</p>}
      <div className="design-actions">
        <button type="button" className="studio-primary" disabled={Boolean(busy) || !videoSupported() || tooLong || needsRights} onClick={build}>{busy === 'build' ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}{result ? (tr ? 'Yeniden oluştur' : 'Make it again') : (tr ? 'Videoyu oluştur' : 'Make the video')}</button>
      </div>
      {needsRights && <p className="studio-note">{tr ? 'Müziği kullanmak için hak onayını işaretleyin.' : 'Tick the rights box to use the music.'}</p>}
      {progress && <p className="studio-note" role="status" aria-live="polite">{progress}</p>}
      {result && <div className="video-result">
        <video src={result.url} controls playsInline className="video-result-player" aria-label={tr ? 'Hazırlanan video' : 'The video'} />
        <p className="studio-note">{seconds(result.durationMs)} sn · {Math.round(result.bytes.length / 1024 / 102.4) / 10} MB · {result.hasAudio ? (tr ? 'sesli' : 'with sound') : (tr ? 'sessiz' : 'silent')}</p>
        <div className="design-actions">
          {onUseVideo && <button type="button" className="studio-primary" disabled={Boolean(busy)} onClick={add}>{busy === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{tr ? 'Taslağa ekle' : 'Add to the draft'}</button>}
          <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={() => saveFile(result.bytes, `video-${size.w}x${size.h}.mp4`, 'video/mp4')}><Download size={15} />{tr ? 'MP4 indir' : 'Download MP4'}</button>
        </div>
      </div>}
    </section>
  );
}
