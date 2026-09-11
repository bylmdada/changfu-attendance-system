import {
  normalizePropertyAuditStatus,
  propertyAuditStatusLabel,
} from '@/lib/property-audit-status';

describe('property audit status', () => {
  it('normalizes legacy values and keeps Chinese display labels', () => {
    expect(normalizePropertyAuditStatus('待主管稽核')).toBe('PENDING');
    expect(normalizePropertyAuditStatus('已通過')).toBe('APPROVED');
    expect(normalizePropertyAuditStatus('退回補正')).toBe('REJECTED');
    expect(propertyAuditStatusLabel('PENDING')).toBe('待主管稽核');
    expect(propertyAuditStatusLabel('APPROVED')).toBe('已通過');
    expect(propertyAuditStatusLabel('REJECTED')).toBe('退回補正');
  });
});
