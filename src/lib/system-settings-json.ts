export function safeParseSystemSettingsValue<T>(
  rawValue: string | null | undefined,
  fallback: T,
  key: string
): T {
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn(`Failed to parse system setting ${key}:`, error);
    return fallback;
  }
}