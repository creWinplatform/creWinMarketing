/**
 * PATCH  /api/ads/meta/campaign/[id]   — Update campaign (status, budget)
 * DELETE /api/ads/meta/campaign/[id]   — Archive campaign
 */
import { NextRequest, NextResponse } from 'next/server';

const GRAPH = 'https://graph.facebook.com/v19.0';
const token = () => process.env.META_ADS_ACCESS_TOKEN || '';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!token()) return NextResponse.json({ success: true, mock: true });

  try {
    const patch = await req.json() as Record<string, string | number>;
    const body  = new URLSearchParams({ access_token: token() });
    for (const [k, v] of Object.entries(patch)) body.append(k, String(v));
    const res  = await fetch(`${GRAPH}/${id}`, { method: 'POST', body });
    const json = await res.json() as { success?: boolean; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
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
  if (!token()) return NextResponse.json({ success: true, mock: true });

  try {
    const body = new URLSearchParams({ status: 'ARCHIVED', access_token: token() });
    const res  = await fetch(`${GRAPH}/${id}`, { method: 'POST', body });
    const json = await res.json() as { success?: boolean; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
