import { formatPurchaseRequestNumber, getNextPurchaseRequestSequence } from '../purchase-request-number';

const prefix = 'PR-202611';
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => formatPurchaseRequestNumber(prefix, from + i));

describe('getNextPurchaseRequestSequence', () => {
  it('starts at 1 when the month has no request', () => {
    expect(getNextPurchaseRequestSequence([], prefix)).toBe(1);
  });

  it('continues after the highest number', () => {
    expect(getNextPurchaseRequestSequence(range(1, 7), prefix)).toBe(8);
  });

  it('keeps counting through 999, 1000 and 1001 instead of repeating 1000', () => {
    expect(getNextPurchaseRequestSequence(range(1, 999), prefix)).toBe(1000);
    expect(getNextPurchaseRequestSequence(range(1, 1000), prefix)).toBe(1001);
    expect(getNextPurchaseRequestSequence(range(1, 1001), prefix)).toBe(1002);
  });

  it('is not fooled by the order of the input', () => {
    const shuffled = [...range(1, 1000)].reverse().sort((a, b) => (a < b ? 1 : -1));
    expect(getNextPurchaseRequestSequence(shuffled, prefix)).toBe(1001);
  });

  it('ignores other months and unexpected formats', () => {
    expect(getNextPurchaseRequestSequence(['PR-202610-050', 'PR-202611-abc', 'PR-202611', 'XX-202611-900', 'PR-202611-002'], prefix)).toBe(3);
  });
});

describe('formatPurchaseRequestNumber', () => {
  it('pads to three digits and lets four digits through', () => {
    expect(formatPurchaseRequestNumber(prefix, 7)).toBe('PR-202611-007');
    expect(formatPurchaseRequestNumber(prefix, 999)).toBe('PR-202611-999');
    expect(formatPurchaseRequestNumber(prefix, 1000)).toBe('PR-202611-1000');
  });
});
