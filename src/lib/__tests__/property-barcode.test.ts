import {
  buildPropertyBarcodeValue,
  parsePropertyBarcodeValue,
} from '@/lib/property-barcode';

describe('property barcode value', () => {
  it('includes and parses the site code while keeping legacy values compatible', () => {
    expect(buildPropertyBarcodeValue('XIBEI', 'A001')).toBe('XIBEI:A001');
    expect(parsePropertyBarcodeValue('XIBEI:A001')).toEqual({
      siteCode: 'XIBEI',
      assetCode: 'A001',
    });
    expect(parsePropertyBarcodeValue('A001')).toEqual({ assetCode: 'A001' });
  });
});
