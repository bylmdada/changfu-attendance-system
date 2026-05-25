import { parseBoundedPositiveInt, parsePositiveInt } from '@/lib/property-query';

describe('property-query', () => {
  describe('parsePositiveInt', () => {
    it('accepts positive integers from strings and numbers', () => {
      expect(parsePositiveInt('12')).toBe(12);
      expect(parsePositiveInt(3)).toBe(3);
    });

    it('rejects missing, non-integer, and non-positive values', () => {
      expect(parsePositiveInt(null)).toBeNull();
      expect(parsePositiveInt('abc')).toBeNull();
      expect(parsePositiveInt('1.5')).toBeNull();
      expect(parsePositiveInt('1e2')).toBeNull();
      expect(parsePositiveInt('0')).toBeNull();
      expect(parsePositiveInt('-1')).toBeNull();
      expect(parsePositiveInt(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    });
  });

  describe('parseBoundedPositiveInt', () => {
    it('uses defaults and clamps to max', () => {
      expect(parseBoundedPositiveInt(null, 50, 200)).toBe(50);
      expect(parseBoundedPositiveInt('500', 50, 200)).toBe(200);
      expect(parseBoundedPositiveInt('abc', 50, 200)).toBe(50);
    });
  });
});
