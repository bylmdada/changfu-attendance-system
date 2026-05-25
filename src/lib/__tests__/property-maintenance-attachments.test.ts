import {
  detectPropertyAssessmentMimeType,
  getPropertyAssessmentFileExtension,
} from '@/lib/property-maintenance-attachments';

describe('property maintenance attachments', () => {
  it('detects supported file signatures instead of trusting client MIME types', () => {
    expect(detectPropertyAssessmentMimeType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(detectPropertyAssessmentMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectPropertyAssessmentMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(detectPropertyAssessmentMimeType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('application/msword');
    expect(detectPropertyAssessmentMimeType(Buffer.from('MZ fake exe'))).toBeNull();
  });

  it('detects docx zip packages only when Word markers are present', () => {
    const docxLike = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('abc[Content_Types].xmlxyzword/document.xml'),
    ]);
    const genericZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('archive/file.txt'),
    ]);

    expect(detectPropertyAssessmentMimeType(docxLike)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(detectPropertyAssessmentMimeType(genericZip)).toBeNull();
  });

  it('maps supported MIME types to safe storage extensions', () => {
    expect(getPropertyAssessmentFileExtension('application/pdf')).toBe('pdf');
    expect(getPropertyAssessmentFileExtension('application/msword')).toBe('doc');
    expect(getPropertyAssessmentFileExtension('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(getPropertyAssessmentFileExtension('image/png')).toBe('png');
    expect(getPropertyAssessmentFileExtension('image/jpeg')).toBe('jpg');
    expect(getPropertyAssessmentFileExtension('text/html')).toBeNull();
  });
});
