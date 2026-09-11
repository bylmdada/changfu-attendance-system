import {
  getPropertyAssessmentClientFileError,
  PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE,
} from '@/lib/property-assessment-file-validation';

describe('property assessment client file validation', () => {
  it('accepts supported files by MIME type or extension for mobile browsers', () => {
    expect(getPropertyAssessmentClientFileError({ name: 'photo.jpg', type: 'image/jpeg', size: 1024 })).toBeNull();
    expect(getPropertyAssessmentClientFileError({ name: 'photo.jpeg', type: '', size: 1024 })).toBeNull();
    expect(getPropertyAssessmentClientFileError({ name: 'report.docx', type: '', size: 1024 })).toBeNull();
  });

  it('rejects iPhone HEIC files with a clear conversion message', () => {
    expect(getPropertyAssessmentClientFileError({ name: 'IMG_0001.HEIC', type: 'image/heic', size: 1024 })).toContain('HEIC/HEIF');
  });

  it('rejects oversized and unsupported files before upload starts', () => {
    expect(getPropertyAssessmentClientFileError({ name: 'big.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toContain('超過 10MB');
    expect(getPropertyAssessmentClientFileError({ name: 'script.svg', type: 'image/svg+xml', size: 1024 })).toContain('格式不支援');
  });

  it('exposes the expected browser accept attribute', () => {
    expect(PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE).toContain('.jpg');
    expect(PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE).toContain('application/pdf');
  });
});
