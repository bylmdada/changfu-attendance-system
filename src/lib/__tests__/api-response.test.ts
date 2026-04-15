import { buildSuccessPayload } from '@/lib/api-response';

describe('buildSuccessPayload', () => {
  it('preserves legacy top-level fields while exposing a data envelope', () => {
    const payload = buildSuccessPayload({ payrollRecords: [{ id: 1 }], message: 'ok' });

    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ payrollRecords: [{ id: 1 }], message: 'ok' });
    expect(payload.payrollRecords).toEqual([{ id: 1 }]);
    expect(payload.message).toBe('ok');
  });
});