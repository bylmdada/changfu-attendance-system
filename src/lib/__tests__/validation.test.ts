import { EMPTY_BODY_PARSE_ERROR, safeParseJSON } from '@/lib/validation';

describe('safeParseJSON', () => {
  it('returns the shared empty-body sentinel for blank requests', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: ''
    });

    await expect(safeParseJSON(request)).resolves.toEqual({
      success: false,
      error: EMPTY_BODY_PARSE_ERROR
    });
  });

  it('returns parsed objects for valid JSON payloads', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alice', enabled: true })
    });

    await expect(safeParseJSON(request)).resolves.toEqual({
      success: true,
      data: { name: 'Alice', enabled: true }
    });
  });

  it('surfaces malformed JSON without reusing the empty-body sentinel', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: '{"name":'
    });

    const result = await safeParseJSON(request);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).not.toBe(EMPTY_BODY_PARSE_ERROR);
  });
});