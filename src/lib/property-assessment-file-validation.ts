import {
  PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES,
  PROPERTY_ASSESSMENT_MAX_FILE_SIZE,
} from '@/lib/property-maintenance-attachment-constants';

const PROPERTY_ASSESSMENT_ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg']);
const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

export const PROPERTY_ASSESSMENT_ACCEPT_ATTRIBUTE = [
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
].join(',');

function getFileExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.trim().toLowerCase();
  return extension && extension !== fileName.toLowerCase() ? extension : '';
}

export function getPropertyAssessmentClientFileError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size <= 0) {
    return `${file.name || '檔案'} 是空檔案，請重新選擇`;
  }

  if (file.size > PROPERTY_ASSESSMENT_MAX_FILE_SIZE) {
    return `${file.name || '檔案'} 超過 10MB，請壓縮後再上傳`;
  }

  const extension = getFileExtension(file.name || '');
  if (HEIC_EXTENSIONS.has(extension) || file.type === 'image/heic' || file.type === 'image/heif') {
    return '目前支援 JPG/JPEG、PNG、PDF、Word；iPhone HEIC/HEIF 請先轉成 JPG 後再上傳';
  }

  if (
    (file.type && PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES.has(file.type)) ||
    PROPERTY_ASSESSMENT_ALLOWED_EXTENSIONS.has(extension)
  ) {
    return null;
  }

  return `${file.name || '檔案'} 格式不支援，請上傳 PDF、Word、PNG、JPG 或 JPEG`;
}
