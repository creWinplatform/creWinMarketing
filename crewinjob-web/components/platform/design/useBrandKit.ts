'use client';
import { useCallback, useEffect, useState } from 'react';
import { projectRequest } from '@/lib/platform/client';
import { DEFAULT_BRAND_KIT, type BrandKit } from '@/lib/platform/brand-kit-types';
import { fontsReady, loadImage } from './render';

// The project's brand kit with its logo decoded and its font loaded, ready for the canvas.
export function useBrandKit() {
  const [kit, setKitState] = useState<BrandKit | null>(null), [logo, setLogo] = useState<HTMLImageElement | null>(null), [error, setError] = useState('');
  const setKit = useCallback(async (value: BrandKit) => {
    await fontsReady(value.font);
    let image: HTMLImageElement | null = null;
    if (value.logo) { try { image = await loadImage(`data:${value.logo.mime};base64,${value.logo.data}`); } catch { image = null; } }
    setLogo(image); setKitState(value);
  }, []);
  const reload = useCallback(async () => {
    setError('');
    // If the kit cannot be read, designs still work with the default colours; the error is shown where the kit is edited.
    try { await setKit(await projectRequest<BrandKit>('/api/platform/brand-kit')); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Marka kiti yüklenemedi.'); await setKit({ ...DEFAULT_BRAND_KIT, revision: 0, logo: null, updatedAt: null, canEdit: false }); }
  }, [setKit]);
  useEffect(() => { void reload(); }, [reload]);
  return { kit, logo, error, reload, setKit };
}
