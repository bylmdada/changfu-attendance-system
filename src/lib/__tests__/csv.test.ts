import { escapeCsvValue, toCsvRow } from '@/lib/csv';

describe('csv helpers', () => {
  it('neutralizes dangerous spreadsheet formulas in string fields', () => {
    expect(escapeCsvValue('=SUM(1+2)')).toBe("'=SUM(1+2)");
    expect(escapeCsvValue('+cmd')).toBe("'+cmd");
    expect(escapeCsvValue('-danger')).toBe("'-danger");
    expect(escapeCsvValue('@evil')).toBe("'@evil");
  });

  it('keeps numeric values numeric-looking instead of prefixing apostrophes', () => {
    expect(escapeCsvValue(-123)).toBe('-123');
    expect(escapeCsvValue(456)).toBe('456');
  });

  it('quotes values that contain CSV delimiters after neutralization', () => {
    expect(escapeCsvValue('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
    expect(toCsvRow(['safe', 'line\nbreak', '"quoted"'])).toBe('safe,"line\nbreak","""quoted"""');
  });
});