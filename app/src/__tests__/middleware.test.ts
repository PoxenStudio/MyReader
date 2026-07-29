import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const coep = (path: string) =>
  middleware(new NextRequest(`http://localhost:3000${path}`)).headers.get(
    'Cross-Origin-Embedder-Policy',
  );

describe('middleware cross-origin isolation headers', () => {
  it('serves require-corp on every document route', () => {
    expect(coep('/')).toBe('require-corp');
    expect(coep('/library')).toBe('require-corp');
    expect(coep('/settings')).toBe('require-corp');
    expect(coep('/search')).toBe('require-corp');
  });

  it('always pairs COOP same-origin on document responses', () => {
    const res = middleware(new NextRequest('http://localhost:3000/library'));
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('does not put COEP on /api routes', () => {
    const res = middleware(new NextRequest('http://localhost:3000/api/mybooks/whoami'));
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBeNull();
  });
});
