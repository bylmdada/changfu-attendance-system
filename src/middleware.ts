import { NextResponse } from 'next/server';

// Legacy identity documents must never be served as public assets.
export function middleware() {
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export const config = { matcher: ['/uploads/dependent-attachments/:path*'] };
