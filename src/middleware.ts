import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Legacy identity documents must never be served as public assets.
  if (pathname === '/uploads/dependent-attachments' || pathname.startsWith('/uploads/dependent-attachments/')) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // Pages submit through /api routes; no page currently exposes a Server Action.
  // Reject unsupported page writes before Next tries to parse an action/FormData.
  if (!pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return new NextResponse(null, {
      status: 405,
      headers: { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
