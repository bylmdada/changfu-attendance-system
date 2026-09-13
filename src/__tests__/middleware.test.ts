import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { middleware, config } from '@/middleware';

describe('page request boundary', () => {
  it.each(['https://poe.pipe.bz/', 'https://changfu.me/RSC/pzsqtc53mx5738z.txt', 'https://changfu.me/login'])(
    'rejects unsupported POST %s before Server Action parsing', url => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
      const response = middleware(new NextRequest(url, {
        method: 'POST', headers: { 'next-action': 'invalid', 'content-type': 'multipart/form-data' }, body: 'invalid',
      }));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toContain('GET');
    }
  );

  it.each(['/api/auth/login', '/api/purchase-requests', '/api/property-maintenance/assets/lookup'])(
    'keeps API handlers responsible for %s', pathname => {
      const url = `https://changfu.me${pathname}`;
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
      expect(middleware(new NextRequest(url, { method: 'POST' })).headers.get('x-middleware-next')).toBe('1');
    }
  );

  it.each(['GET', 'HEAD'] as const)('allows normal %s navigation', method => {
    expect(middleware(new NextRequest('https://changfu.me/login', { method })).headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['GET', 'POST'] as const)('preserves private attachment protection for %s', method => {
    const url = 'https://changfu.me/uploads/dependent-attachments/proof.pdf';
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    expect(middleware(new NextRequest(url, { method })).status).toBe(404);
  });
});
