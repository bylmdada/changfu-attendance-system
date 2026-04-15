import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/test-password-strength/route';

describe('/api/auth/test-password-strength', () => {
  it('rejects null request bodies before destructuring password strength inputs', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '密碼不能為空' });
  });

  it('rejects malformed password policies before evaluating rule fields', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        password: 'Abc123!!',
        policy: null
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '密碼政策設定無效' });
  });

  it('rejects malformed JSON request bodies before destructuring password strength inputs', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"password":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
  });
});