export {
  PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES,
  PROPERTY_ASSESSMENT_MAX_FILE_SIZE,
  PROPERTY_ASSESSMENT_MAX_FILES,
} from '@/lib/property-maintenance-attachment-constants';

export function getPropertyAssessmentFileExtension(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    default:
      return null;
  }
}

export function detectPropertyAssessmentMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  if (buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return 'application/pdf';
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return 'application/msword';
  }

  const isZip = (
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  );
  if (
    isZip &&
    buffer.includes(Buffer.from('[Content_Types].xml')) &&
    buffer.includes(Buffer.from('word/'))
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  return null;
}

export async function optimizePropertyAssessmentFile(
  buffer: Buffer,
  mimeType: string
): Promise<Buffer> {
  if (mimeType !== 'image/png') {
    return buffer;
  }

  const sharp = (await import('sharp')).default;
  const optimized = await sharp(buffer)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return optimized.length < buffer.length ? optimized : buffer;
}
