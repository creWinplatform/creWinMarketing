import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { platformDatabase } from '@/lib/platform/database';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { recordVisit } from '@/lib/platform/prospect-sources';
export const dynamic = 'force-dynamic';
// The consented page view beacon of public/rz-visit.js on a customer's own site. Plain text (no preflight), always
// an empty 204 so the page learns nothing; the IP is used for one lookup and never stored.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
export async function POST(request: NextRequest) {
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBodyBytes(request, 1024))) as { k?: unknown; p?: unknown };
    // Deploy behind a trusted proxy that overwrites X-Forwarded-For (as for payments).
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    if (typeof body.k === 'string' && typeof body.p === 'string' && isIP(ip)) await recordVisit(platformDatabase(), { key: body.k, origin: request.headers.get('origin'), path: body.p, ip });
  } catch { /* the beacon never reports failures */ }
  return new NextResponse(null, { status: 204, headers });
}
export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }
