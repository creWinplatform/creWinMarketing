import { NextResponse } from 'next/server';
import type { AdPlatformStatus } from '@/lib/ads-types';
import { defaultCurrency, isConfigured, missingEnv } from '../_lib/platforms';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Yapılandırma her istekte env'den okunur; list/create route'ları aynı kuralı (missingEnv) kullanır.
// Yalnızca eksik değişken ADLARI döner, değerler asla.
export async function GET() {
  const currency = defaultCurrency();
  const statuses: AdPlatformStatus[] = [
    {
      platform:   'meta',
      configured: isConfigured('meta'),
      accountId:  process.env.META_ADS_ACCOUNT_ID || null,
      label:      'Facebook & Instagram Ads',
      icon:       '📘',
      missingEnv: missingEnv('meta'),
      currency,
    },
    {
      platform:   'linkedin',
      configured: isConfigured('linkedin'),
      accountId:  process.env.LINKEDIN_ADS_ACCOUNT_ID || null,
      label:      'LinkedIn Ads',
      icon:       '💼',
      missingEnv: missingEnv('linkedin'),
      currency,
    },
    {
      platform:   'google',
      configured: isConfigured('google'),
      accountId:  process.env.GOOGLE_ADS_CUSTOMER_ID || null,
      label:      'Google Ads',
      icon:       '🔍',
      missingEnv: missingEnv('google'),
      currency,
    },
  ];

  return NextResponse.json(statuses, { headers: { 'Cache-Control': 'no-store' } });
}
