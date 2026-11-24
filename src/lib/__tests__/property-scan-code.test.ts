import { normalizeScannedCode } from '@/lib/property-scan-code';
import { buildPropertyBarcodeValue, parsePropertyBarcodeValue } from '@/lib/property-barcode';

describe('normalizeScannedCode', () => {
  it('keeps the site code of the current barcode format so the right site is looked up', () => {
    const scanned = buildPropertyBarcodeValue('XIBEI', 'A001');

    expect(normalizeScannedCode(scanned)).toBe('XIBEI:A001');
    expect(parsePropertyBarcodeValue(normalizeScannedCode(scanned))).toEqual({
      siteCode: 'XIBEI',
      assetCode: 'A001',
    });
  });

  it('keeps legacy bare codes and trims scanner whitespace', () => {
    expect(normalizeScannedCode('  2122330301-0008\n')).toBe('2122330301-0008');
    expect(normalizeScannedCode('A001')).toBe('A001');
    expect(normalizeScannedCode('   ')).toBe('');
  });

  it('still reads existing URL-style QR codes', () => {
    expect(normalizeScannedCode('https://example.com/property-management/scan?code=A001')).toBe('A001');
    expect(normalizeScannedCode('https://example.com/scan?assetCode=XIBEI%3AA001')).toBe('XIBEI:A001');
    expect(normalizeScannedCode('http://example.com/assets/A001')).toBe('A001');
    expect(normalizeScannedCode('HTTPS://example.com/assets/B002/')).toBe('B002');
  });
});
