'use client';

interface Props {
  platform: string;
  content: string;
  username?: string;
}

const PLATFORM_USERNAMES: Record<string, string> = {
  instagram: 'crewinjob',
  facebook: 'CrewinJob',
  twitter: '@crewinjob',
  linkedin: 'CrewinJob',
  tiktok: '@crewinjob',
};

function truncate(text: string, max: number) {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

export default function PlatformPreview({ platform, content, username }: Props) {
  const displayName = username || PLATFORM_USERNAMES[platform] || 'crewinjob';

  if (platform === 'twitter') {
    const { text, truncated } = truncate(content, 280);
    return (
      <div className="bg-slate-950 text-white rounded-2xl p-4 max-w-sm font-sans border border-slate-700">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-ocean flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="font-bold text-sm text-white">CrewinJob</span>
              <span className="text-slate-400 text-xs">{displayName.startsWith('@') ? displayName : `@${displayName}`}</span>
            </div>
            <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
              {text}{truncated && <span className="text-slate-400">...</span>}
            </p>
            <div className="flex items-center gap-6 mt-3 text-slate-500 text-xs">
              <span className="flex items-center gap-1 hover:text-sky-400 cursor-pointer">💬 <span>0</span></span>
              <span className="flex items-center gap-1 hover:text-green-400 cursor-pointer">🔁 <span>0</span></span>
              <span className="flex items-center gap-1 hover:text-pink-400 cursor-pointer">❤️ <span>0</span></span>
              <span className="flex items-center gap-1 hover:text-sky-400 cursor-pointer">📤</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (platform === 'linkedin') {
    const { text, truncated } = truncate(content, 300);
    return (
      <div className="bg-white text-slate-900 rounded-xl shadow-md max-w-sm border border-slate-200 font-sans overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold shrink-0">C</div>
            <div>
              <p className="font-semibold text-sm text-slate-900">CrewinJob</p>
              <p className="text-xs text-slate-500">CrewinJob • 1st</p>
              <p className="text-xs text-slate-400">Maritime Recruitment Platform</p>
            </div>
          </div>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {text}
            {truncated && (
              <span> <button className="text-blue-600 font-medium text-xs">...see more</button></span>
            )}
          </p>
        </div>
        <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">👍 Like</span>
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">💬 Comment</span>
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">🔁 Repost</span>
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer ml-auto">📤 Send</span>
        </div>
      </div>
    );
  }

  if (platform === 'instagram') {
    const { text, truncated } = truncate(content, 250);
    return (
      <div className="bg-white text-slate-900 rounded-xl shadow-md max-w-sm border border-slate-200 font-sans overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-100">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">C</div>
          <span className="font-semibold text-sm">{displayName}</span>
          <span className="ml-auto text-slate-400 text-lg">···</span>
        </div>
        <div className="bg-slate-100 aspect-square flex items-center justify-center">
          <span className="text-4xl opacity-30">📸</span>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-4 mb-2 text-xl">
            <span className="cursor-pointer">🤍</span>
            <span className="cursor-pointer">💬</span>
            <span className="cursor-pointer">📤</span>
            <span className="ml-auto cursor-pointer">🔖</span>
          </div>
          <p className="text-xs font-semibold text-slate-800 mb-1">0 likes</p>
          <p className="text-xs text-slate-700 leading-relaxed">
            <span className="font-semibold">{displayName}</span>{' '}
            {text}{truncated && <span className="text-blue-500 cursor-pointer"> more</span>}
          </p>
        </div>
      </div>
    );
  }

  if (platform === 'facebook') {
    const { text, truncated } = truncate(content, 400);
    return (
      <div className="bg-white text-slate-900 rounded-xl shadow-md max-w-sm border border-slate-200 font-sans overflow-hidden">
        <div className="flex items-start gap-3 p-4 pb-2">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold shrink-0">C</div>
          <div>
            <p className="font-semibold text-sm text-slate-900">CrewinJob</p>
            <p className="text-xs text-slate-400">Just now · 🌐</p>
          </div>
          <span className="ml-auto text-slate-400 text-lg cursor-pointer">···</span>
        </div>
        <div className="px-4 pb-3">
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {text}{truncated && <span className="text-blue-600 cursor-pointer text-xs"> See more</span>}
          </p>
        </div>
        <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-around text-xs text-slate-500">
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">👍 Like</span>
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">💬 Comment</span>
          <span className="flex items-center gap-1 hover:text-blue-600 cursor-pointer">↗️ Share</span>
        </div>
      </div>
    );
  }

  if (platform === 'tiktok') {
    const { text, truncated } = truncate(content, 200);
    return (
      <div className="bg-slate-950 text-white rounded-2xl max-w-xs font-sans overflow-hidden border border-slate-700 relative" style={{ minHeight: '340px' }}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950/90" />
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-pink-500 border-2 border-white flex items-center justify-center text-xs font-bold">C</div>
          <span className="text-xs font-semibold">@crewinjob</span>
          <span className="text-[10px] border border-red-500 text-red-400 px-1.5 rounded">Follow</span>
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 text-white">
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl cursor-pointer">❤️</span>
            <span className="text-[10px]">0</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl cursor-pointer">💬</span>
            <span className="text-[10px]">0</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl cursor-pointer">↗️</span>
            <span className="text-[10px]">Share</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">🎵</div>
        </div>
        <div className="absolute bottom-6 left-3 right-12">
          <p className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap">
            {text}{truncated && <span className="text-slate-400">...</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-xs">🎵</span>
            <span className="text-[10px] text-slate-300 truncate">Original Sound - crewinjob</span>
          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 max-w-sm">
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
    </div>
  );
}
