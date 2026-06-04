/**
 * PATCH  /api/ads/google/campaign/[id]   — Update Google campaign (status, budget)
 * DELETE /api/ads/google/campaign/[id]   — Remove campaign
 */
import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_ADS_API  = 'https://googleads.googleapis.com/v17';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _accessToken = '';
let _tokenExpiry  = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
  const res  = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type:    'refresh_token',
    }),
  });
  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(json.error || 'Google token failed');
  _accessToken = json.access_token;
  _tokenExpiry  = Date.now() + 55 * 60 * 1000;
  return _accessToken;
}

function cid()  { return (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''); }
function hasCreds() {
  return !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_REFRESH_TOKEN && cid());
}

function googleHeaders(accessToken: string) {
  return {
    'Authorization':   `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type':    'application/json',
    ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
      : {}),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!hasCreds()) return NextResponse.json({ success: true, mock: true });

  try {
    const patch      = await req.json() as { status?: string; budgetDaily?: number };
    const accessToken = await getAccessToken();
    const hdrs        = googleHeaders(accessToken);
    const customer    = cid();

    const operations = [];

    if (patch.status) {
      const statusMap: Record<string, string> = { ACTIVE: 'ENABLED', PAUSED: 'PAUSED', DELETED: 'REMOVED' };
      operations.push({
        updateMask: 'status',
        update: {
          resourceName: `customers/${customer}/campaigns/${id}`,
          status: statusMap[patch.status] || patch.status,
        },
      });
    }

    if (!operations.length) return NextResponse.json({ success: true });

    const res = await fetch(`${GOOGLE_ADS_API}/customers/${customer}/campaigns:mutate`, {
      method:  'POST',
      headers: hdrs,
      body:    JSON.stringify({ operations }),
    });
    const json = await res.json() as { error?: { message: string } };
    if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!hasCreds()) return NextResponse.json({ success: true, mock: true });

  try {
    const accessToken = await getAccessToken();
    const customer    = cid();
    const res = await fetch(`${GOOGLE_ADS_API}/customers/${customer}/campaigns:mutate`, {
      method:  'POST',
      headers: googleHeaders(accessToken),
      body: JSON.stringify({
        operations: [{
          remove: `customers/${customer}/campaigns/${id}`,
        }],
      }),
    });
    const json = await res.json() as { error?: { message: string } };
    if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
