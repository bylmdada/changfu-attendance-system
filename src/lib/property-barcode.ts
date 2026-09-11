import bwipjs from 'bwip-js/node';

const PROPERTY_BARCODE_SEPARATOR = ':';

export function buildPropertyBarcodeValue(siteCode: string, assetCode: string): string {
  return `${siteCode.trim()}${PROPERTY_BARCODE_SEPARATOR}${assetCode.trim()}`;
}

export function parsePropertyBarcodeValue(value: string): { siteCode?: string; assetCode: string } {
  const code = value.trim();
  const separatorIndex = code.indexOf(PROPERTY_BARCODE_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === code.length - 1) return { assetCode: code };
  return {
    siteCode: code.slice(0, separatorIndex),
    assetCode: code.slice(separatorIndex + 1),
  };
}

export function isCode128Compatible(text: string): boolean {
  return /^[\x20-\x7E]{1,80}$/.test(text);
}

export async function generateCode128PngBuffer(text: string): Promise<Buffer> {
  if (!isCode128Compatible(text)) {
    throw new Error('Asset code is not compatible with CODE_128');
  }
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    textsize: 9,
  });
}

export async function generateCode128DataUrl(text: string): Promise<string> {
  const png = await generateCode128PngBuffer(text);
  return `data:image/png;base64,${png.toString('base64')}`;
}
