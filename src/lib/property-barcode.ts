import bwipjs from 'bwip-js/node';

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
