/**
 * PATCH  /api/ads/linkedin/campaign/[id]
 * DELETE /api/ads/linkedin/campaign/[id]
 */
import { NextRequest, NextResponse } from 'next/server';

const LI_API = 'https://api.linkedin.com/v2';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN || ''}`,
    'Content-Type':  'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!process.env.LINKEDIN_ACCESS_TOKEN) return NextResponse.json({ success: true, mock: true });

  try {
    const patch = await req.json() as Record<string, unknown>;
    const urn   = `urn:li:sponsoredCampaign:${id}`;
    const res   = await fetch(`${LI_API}/adCampaignsV2/${encodeURIComponent(urn)}`, {
      method:  'POST',
      headers: { ...headers(), 'X-Restli-Method': 'partial_update' },
      body:    JSON.stringify({ patch: { $set: patch } }),
    });
    if (!res.ok) {
      const json = await res.json() as { message?: string };
      throw new Error(json.message || `HTTP ${res.status}`);
    }
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
  if (!process.env.LINKEDIN_ACCESS_TOKEN) return NextResponse.json({ success: true, mock: true });

  try {
    const urn = `urn:li:sponsoredCampaign:${id}`;
    const res = await fetch(`${LI_API}/adCampaignsV2/${encodeURIComponent(urn)}`, {
      method:  'POST',
      headers: { ...headers(), 'X-Restli-Method': 'partial_update' },
      body:    JSON.stringify({ patch: { $set: { status: 'ARCHIVED' } } }),
    });
    if (!res.ok) {
      const json = await res.json() as { message?: string };
      throw new Error(json.message || `HTTP ${res.status}`);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
