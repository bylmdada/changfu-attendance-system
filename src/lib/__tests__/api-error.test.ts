import { extractApiErrorMessage } from '@/lib/api-error';

describe('extractApiErrorMessage', () => {
  it('prefers the API error field when present', () => {
    expect(
      extractApiErrorMessage({ error: '名稱、經緯度和半徑為必填欄位' }, '操作失敗')
    ).toBe('名稱、經緯度和半徑為必填欄位');
  });

  it('falls back to the message field when error is missing', () => {
    expect(
      extractApiErrorMessage({ message: '位置更新成功' }, '操作失敗')
    ).toBe('位置更新成功');
  });

  it('returns the provided fallback when the payload has no usable message', () => {
    expect(extractApiErrorMessage({ code: 'BAD_REQUEST' }, '操作失敗')).toBe('操作失敗');
    expect(extractApiErrorMessage(null, '操作失敗')).toBe('操作失敗');
  });
});