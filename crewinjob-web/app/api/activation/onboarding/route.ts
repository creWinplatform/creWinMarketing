import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// GET /api/activation/onboarding?userId=123  → GetOnboardingState
// Kullanıcı-bazlı endpoint — bu panel her zaman belirli bir kullanıcıyı sorguladığından userId ZORUNLU.
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: '"userId" zorunludur.' }, { status: 400 });
    }
    const api = agentModule('modules/api.js');
    const result = await api.getOnboardingState(userId);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const ACTION_TO_EVENT: Record<string, string> = {
  MarkOnboardingShown: 'onboarding_shown',
  SkipOnboarding:      'onboarding_skipped',
  CompleteOnboarding:  'onboarding_completed',
};

// POST /api/activation/onboarding  body: { action: 'MarkOnboardingShown' | 'SkipOnboarding' | 'CompleteOnboarding', userId? }
// NOT: Bu proxy servis/admin token'ıyla çağrılır — MarkOnboardingShown/SkipOnboarding/CompleteOnboarding
// backend'de "login olan kullanıcı" varsayımıyla çalışıyorsa, gerçek seafarer akışında bu endpoint'in
// seafarer'ın KENDİ auth token'ıyla (bizim admin token'ımızla değil) çağrılması gerekir — Bölüm B kapsamı.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action: string; userId?: number };
    const allowed = ['MarkOnboardingShown', 'SkipOnboarding', 'CompleteOnboarding'];
    if (!allowed.includes(body.action)) {
      return NextResponse.json({ error: `Geçersiz aksiyon: ${body.action}` }, { status: 400 });
    }
    if (body.userId !== undefined && body.userId !== null && !(Number.isSafeInteger(Number(body.userId)) && Number(body.userId) > 0)) {
      return NextResponse.json({ error: 'Geçersiz "userId".' }, { status: 400 });
    }
    const api = agentModule('modules/api.js');
    // userId verilirse aksiyon o seafarer adına uygulanır (aksi halde servis hesabının kendisine uygulanırdı).
    // api.js tarafı: postOnboardingAction(action, userId?) — agent-side sahibi imzayı güncelliyor.
    const result = await api.postOnboardingAction(body.action, body.userId != null ? Number(body.userId) : undefined);

    const eventName = ACTION_TO_EVENT[body.action];
    if (eventName && body.userId) {
      void api.trackActivationEvent(eventName, body.userId).catch(() => null);
    }

    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
