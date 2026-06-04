import { NextResponse } from 'next/server';
import type { AdPlatformStatus } from '@/lib/ads-types';

export async function GET() {
  const statuses: AdPlatformStatus[] = [
    {
      platform:   'meta',
      configured: !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID),
      accountId:  process.env.META_ADS_ACCOUNT_ID || null,
      label:      'Facebook & Instagram Ads',
      icon:       '📘',
    },
    {
      platform:   'linkedin',
      configured: !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ADS_ACCOUNT_ID),
      accountId:  process.env.LINKEDIN_ADS_ACCOUNT_ID || null,
      label:      'LinkedIn Ads',
      icon:       '💼',
    },
    {
      platform:   'google',
      configured: !!(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
      ),
      accountId:  process.env.GOOGLE_ADS_CUSTOMER_ID || null,
      label:      'Google Ads',
      icon:       '🔍',
    },
  ];

  return NextResponse.json(statuses);
}
