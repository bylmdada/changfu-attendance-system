import { isAbsolute, posix, relative, resolve } from 'path';

const PROPERTY_ATTACHMENT_PREFIX = 'uploads/property-maintenance/';
const ENCODED_PATH_TOKEN_PATTERN = /%(?:2e|2f|5c)/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export function normalizePropertyAttachmentPath(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  if (CONTROL_CHARACTER_PATTERN.test(raw) || ENCODED_PATH_TOKEN_PATTERN.test(raw)) return null;

  const normalized = posix.normalize(raw);
  if (
    normalized === 'uploads/property-maintenance' ||
    !normalized.startsWith(PROPERTY_ATTACHMENT_PREFIX) ||
    normalized.includes('/../')
  ) {
    return null;
  }

  return normalized;
}

export function resolvePropertyAttachmentPath(value: unknown): string | null {
  const normalized = normalizePropertyAttachmentPath(value);
  if (!normalized) return null;

  const basePath = resolve(process.cwd(), 'uploads', 'property-maintenance');
  const fullPath = resolve(process.cwd(), normalized);
  const relativePath = relative(basePath, fullPath);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  return fullPath;
}
