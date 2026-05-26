'use client';
import { useState, useEffect, useRef } from 'react';

export const TEXT_MODEL_KEY  = 'crewinjob_text_model';
export const IMAGE_MODEL_KEY = 'crewinjob_image_model';

export const TEXT_MODELS = [
  { value: 'gemini-2.5-flash',           label: 'Gemini 2.5 Flash',           tag: '⭐ Önerilen' },
  { value: 'gemini-2.5-pro',             label: 'Gemini 2.5 Pro',             tag: '🧠 En Güçlü' },
  { value: 'gemini-2.5-flash-lite',      label: 'Gemini 2.5 Flash Lite',      tag: '⚡ En Hızlı' },
  { value: 'gemini-3-flash-preview',     label: 'Gemini 3 Flash Preview',     tag: '🆕 Yeni' },
  { value: 'gemini-3.1-pro-preview',     label: 'Gemini 3.1 Pro Preview',     tag: '🆕 En Yeni' },
  { value: 'gemini-2.0-flash-lite',      label: 'Gemini 2.0 Flash Lite',      tag: '🔒 Kararlı' },
];

export const IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', tag: '⭐ Önerilen' },
  { value: 'gemini-2.5-flash-image',         label: 'Gemini 2.5 Flash Image', tag: '🔄 Alternatif' },
  { value: 'gemini-3-pro-image-preview',     label: 'Gemini 3 Pro Image',     tag: '🎨 Yüksek Kalite' },
];

export function getTextModel()  { try { return localStorage.getItem(TEXT_MODEL_KEY)  || TEXT_MODELS[0].value;  } catch { return TEXT_MODELS[0].value;  } }
export function getImageModel() { try { return localStorage.getItem(IMAGE_MODEL_KEY) || IMAGE_MODELS[0].value; } catch { return IMAGE_MODELS[0].value; } }

export default function ModelPicker() {
  const [open,       setOpen]       = useState(false);
  const [textModel,  setTextModel]  = useState(TEXT_MODELS[0].value);
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTextModel(getTextModel());
    setImageModel(getImageModel());
  }, []);

  // Dışarı tıklanınca kapat
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const saveText = (v: string) => {
    setTextModel(v);
    try { localStorage.setItem(TEXT_MODEL_KEY, v); } catch { /* ignore */ }
  };

  const saveImage = (v: string) => {
    setImageModel(v);
    try { localStorage.setItem(IMAGE_MODEL_KEY, v); } catch { /* ignore */ }
  };

  const textLabel  = TEXT_MODELS.find(m => m.value === textModel)?.label  || textModel;
  const imageLabel = IMAGE_MODELS.find(m => m.value === imageModel)?.label || imageModel;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs bg-white/10 hover:bg-white/20 text-white/90 px-3 py-1.5 rounded-lg transition-colors border border-white/10"
        title="Model seçimi"
      >
        <span>⚙️</span>
        <span className="hidden sm:inline">{textLabel}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl z-50 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-700 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">⚙️ Model Ayarları</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Seçimler tarayıcıda kaydedilir</p>
          </div>

          <div className="p-4 flex flex-col gap-4">
            {/* Metin Modeli */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                🤖 İçerik Üretimi (Metin)
              </label>
              <div className="flex flex-col gap-1">
                {TEXT_MODELS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => saveText(m.value)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      textModel === m.value
                        ? 'bg-ocean text-white'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      textModel === m.value
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
                    }`}>{m.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700" />

            {/* Görsel Modeli */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                🎨 Görsel Üretimi
              </label>
              <div className="flex flex-col gap-1">
                {IMAGE_MODELS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => saveImage(m.value)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      imageModel === m.value
                        ? 'bg-ocean text-white'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      imageModel === m.value
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
                    }`}>{m.tag}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2.5 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Aktif: <strong className="text-slate-600 dark:text-slate-300">{textLabel}</strong> · <strong className="text-slate-600 dark:text-slate-300">{imageLabel}</strong>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
