import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe used by scripts and the e2e suite. */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'clipflow',
    phase: 0,
    node: process.version,
    time: new Date().toISOString(),
  });
}
