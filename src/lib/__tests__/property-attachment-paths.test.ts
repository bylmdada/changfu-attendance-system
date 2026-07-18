import {
  normalizePropertyAttachmentPath,
  resolvePropertyAttachmentPath,
} from '@/lib/property-attachment-paths';

describe('property attachment paths', () => {
  it('accepts normalized property-maintenance upload paths', () => {
    expect(normalizePropertyAttachmentPath('uploads/property-maintenance/site/a.jpg')).toBe(
      'uploads/property-maintenance/site/a.jpg'
    );
  });

  it('rejects traversal and absolute paths', () => {
    expect(
      normalizePropertyAttachmentPath('uploads/property-maintenance/../../../etc/passwd')
    ).toBeNull();
    expect(
      normalizePropertyAttachmentPath('uploads/property-maintenance/%2e%2e/%2e%2e/.env')
    ).toBeNull();
    expect(normalizePropertyAttachmentPath('uploads/property-maintenance/site/a\u0000.jpg')).toBeNull();
    expect(normalizePropertyAttachmentPath('/uploads/property-maintenance/site/a.jpg')).toBeNull();
    expect(normalizePropertyAttachmentPath('uploads\\property-maintenance\\site\\a.jpg')).toBeNull();
  });

  it('resolves only paths inside the property-maintenance upload directory', () => {
    const resolved = resolvePropertyAttachmentPath('uploads/property-maintenance/site/a.jpg');

    expect(resolved).toContain('/uploads/property-maintenance/site/a.jpg');
    expect(resolvePropertyAttachmentPath('uploads/property-maintenance/../../.env')).toBeNull();
  });
});
