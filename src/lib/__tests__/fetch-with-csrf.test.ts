import { clearCSRFToken, fetchWithCSRF } from '@/lib/fetchWithCSRF';

const protectedRoute = '/api/purchase-requests';

describe('fetchWithCSRF', () => {
  beforeEach(() => {
    clearCSRFToken();
    jest.restoreAllMocks();
  });

  it('adds csrf header for FormData POST without forcing content-type', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, csrfToken: 'csrf-token-value' }),
      })
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    global.fetch = fetchMock as unknown as typeof fetch;

    const formData = new FormData();
    formData.append('file', new Blob(['test']), 'test.txt');

    await fetchWithCSRF('/api/comp-leave/import', {
      method: 'POST',
      body: formData,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/comp-leave/import',
      expect.objectContaining({
        body: formData,
        credentials: 'include',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-value',
        }),
      })
    );

    const secondCallOptions = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondCallOptions.headers).not.toEqual(
      expect.objectContaining({ 'Content-Type': 'multipart/form-data' })
    );
  });

  it('clears stale token and retries once when the cached token no longer matches the active session', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, csrfToken: 'stale-token' }),
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'CSRF驗證失敗，請重新操作' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, csrfToken: 'fresh-token' }),
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchWithCSRF(protectedRoute, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      protectedRoute,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-csrf-token': 'stale-token',
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      protectedRoute,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-csrf-token': 'fresh-token',
        }),
      })
    );
  });
});